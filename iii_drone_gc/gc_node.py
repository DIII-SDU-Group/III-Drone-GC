###############################################################################
# Imports
###############################################################################

###############################################################################
# ROS2:
import rclpy
from rclpy.node import Node
from rclpy.action import ActionClient
from rclpy.qos import QoSProfile, QoSReliabilityPolicy, QoSHistoryPolicy, QoSDurabilityPolicy

from tf2_ros.buffer import Buffer
from tf2_ros.transform_listener import TransformListener

###############################################################################
# ROS2 interfaces:
from sensor_msgs.msg import Image
from geometry_msgs.msg import PoseStamped
from nav_msgs.msg import Path
from std_msgs.msg import Int16, Float32, String
from rcl_interfaces.msg import ParameterEvent, Parameter

###############################################################################
# Custom interfaces:
from iii_drone_interfaces.msg import Powerline, ControlState, ChargerOperatingMode, ChargerStatus, GripperStatus, SingleLine
from iii_drone_interfaces.action import Takeoff, Landing, FlyToPosition, FlyUnderCable, CableLanding, CableTakeoff, DisarmOnCable, ArmOnCable
from iii_drone_interfaces.srv import GripperCommand, SetTargetCableId, InitiateCharging, InterruptCharging, ProlongCharging
from iii_drone_interfaces.srv import GetParameterYaml, GetDeclaredParameters, SaveParameters, GetParameterFiles, LoadParameters, SetParameterFromGC, GetCurrentParameterFile

###############################################################################
# Custom modules:
from iii_drone_core.utils.math import *

###############################################################################
# Libraries:
import numpy as np

###############################################################################
# Python:
import os
from threading import Lock
import yaml

###############################################################################
# Class
###############################################################################

class IIIGCNode(Node):
    def __init__(self):
        super().__init__("iii_gc", namespace="iii_gc")

        self.declare_parameter("world_frame_id", "world")
        self.declare_parameter("drone_frame_id", "drone")

        self.declare_parameter("takeoff_height_default", 1.0)
        self.declare_parameter("target_cable_distance_default", 1.5)

        self.declare_parameter("config_file_path", "III-Drone-ROS2-pkg/config/params.yaml")
        # self.config_file_path = self.get_parameter("config_file_path").value
        self.config_file_path = "/home/" + os.getenv("USER") + "/.config/iii_drone/params.yaml"

        # self.config_file_path = os.path.dirname(os.path.realpath(__file__)).replace("install/iii_drone/lib/iii_drone", "src/"+config_file_path) 

        qos = QoSProfile(
            depth=10,
            durability=QoSDurabilityPolicy.RMW_QOS_POLICY_DURABILITY_VOLATILE,
            history=QoSHistoryPolicy.RMW_QOS_POLICY_HISTORY_KEEP_LAST,
            reliability=QoSReliabilityPolicy.RMW_QOS_POLICY_RELIABILITY_BEST_EFFORT
        )

        qos_reliable = QoSProfile(
            depth=10,
            durability=QoSDurabilityPolicy.RMW_QOS_POLICY_DURABILITY_VOLATILE,
            history=QoSHistoryPolicy.RMW_QOS_POLICY_HISTORY_KEEP_LAST,
            reliability=QoSReliabilityPolicy.RMW_QOS_POLICY_RELIABILITY_RELIABLE
        )
        
        self.powerline_tuples_ = [] # (id, point)
        self.powerline_quat_ = None
        
        self.pl_lock_ = Lock()
        self.img_lock_ = Lock()
        self.control_state_lock_ = Lock()
        self.action_status_lock_ = Lock()
        self.target_lock_ = Lock()
        self.traj_lock_ = Lock()
        self.battery_voltage_lock_ = Lock()
        self.charging_power_lock_ = Lock()
        self.charger_operating_mode_lock_ = Lock()
        self.charger_status_lock_ = Lock()
        self.gripper_status_lock_ = Lock()
        self.target_cable_id_lock_ = Lock()

        self.future = None
        self.goal_handle = None
        self.action_client = None

        self.img_ = None
        self.control_state_ = "unknown"
        self.target = None
        self.traj = None
        self.target_cable_id_ = None

        self.battery_voltage_ = -1
        self.charging_power_ = -1

        self.charger_operating_mode_ = ChargerOperatingMode()
        self.charger_operating_mode_.operating_mode = 0

        self.charger_status_ = ChargerStatus()
        self.charger_status_.charger_status = 0

        self.gripper_status_ = GripperStatus()
        self.gripper_status_.gripper_status = GripperStatus.GRIPPER_STATUS_OPEN

        self.cont_mission_orch_state = "unknown"
        self.cont_mission_orch_state_lock_ = Lock()

        self.takeoff_client = ActionClient(self, Takeoff, "/control/trajectory_controller/takeoff",feedback_sub_qos_profile=qos)
        self.landing_client = ActionClient(self, Landing, "/control/trajectory_controller/landing",feedback_sub_qos_profile=qos)
        self.fly_to_position_client = ActionClient(self, FlyToPosition, "/control/trajectory_controller/fly_to_position",feedback_sub_qos_profile=qos)
        self.fly_under_cable_client = ActionClient(self, FlyUnderCable, "/control/trajectory_controller/fly_under_cable",feedback_sub_qos_profile=qos)
        self.cable_landing_client = ActionClient(self, CableLanding, "/control/trajectory_controller/cable_landing",feedback_sub_qos_profile=qos)
        self.cable_takeoff_client = ActionClient(self, CableTakeoff, "/control/trajectory_controller/cable_takeoff",feedback_sub_qos_profile=qos)
        self.disarm_on_cable_client = ActionClient(self, DisarmOnCable, "/control/trajectory_controller/disarm_on_cable",feedback_sub_qos_profile=qos)
        self.arm_on_cable_client = ActionClient(self, ArmOnCable, "/control/trajectory_controller/arm_on_cable",feedback_sub_qos_profile=qos)

        self.gripper_command_srv_client = self.create_client(GripperCommand, "/payload/charger_gripper/gripper_command")

        self.set_target_cable_id_srv_client = self.create_client(SetTargetCableId, "/mission/continuous_mission_orchestrator/set_target_cable_id")
        self.initiate_charging_srv_client = self.create_client(InitiateCharging, "/mission/continuous_mission_orchestrator/initiate_charging")
        self.interrupt_charging_srv_client = self.create_client(InterruptCharging, "/mission/continuous_mission_orchestrator/interrupt_charging")
        self.prolong_charging_srv_client = self.create_client(ProlongCharging, "/mission/continuous_mission_orchestrator/prolong_charging")
        
        self.get_parameter_yaml_srv_client = self.create_client(GetParameterYaml, "/configuration/configuration_server/get_parameter_yaml")
        self.get_declared_parameters_srv_client = self.create_client(GetDeclaredParameters, "/configuration/configuration_server/get_declared_parameters")
        self.save_parameters_srv_client = self.create_client(SaveParameters, "/configuration/configuration_server/save_parameters")
        self.get_parameter_files_srv_client = self.create_client(GetParameterFiles, "/configuration/configuration_server/get_parameter_files")
        self.load_parameters_srv_client = self.create_client(LoadParameters, "/configuration/configuration_server/load_parameters")
        self.set_parameter_from_gc_srv_client = self.create_client(SetParameterFromGC, "/configuration/configuration_server/set_parameter_from_gc")
        self.get_current_parameter_file_srv_client = self.create_client(GetCurrentParameterFile, "/configuration/configuration_server/get_current_parameter_file")
        
        self.parameter_event_sub = self.create_subscription(
            ParameterEvent,
            "/parameter_events",
            self.on_parameter_event,
            qos_profile=qos_reliable
        )
        
        self._on_set_parameter_callback = None

        self.tf_buffer = Buffer()
        self.tf_listener = TransformListener(self.tf_buffer, self)

        self.pl_sub_ = self.create_subscription(
            Powerline,
            "/perception/pl_mapper/powerline",
            self.on_pl_msg,
            qos_profile=qos
        )

        self.control_state_sub_ = self.create_subscription(
            ControlState,
            "/control/trajectory_controller/control_state",
            self.on_state_msg,
            qos_profile=qos
        )

        self.target_cable_id_sub_ = self.create_subscription(
            Int16,
            "/control/trajectory_controller/target_cable_id",
            self.on_target_cable_id_msg,
            qos_profile=qos
        )

        self.planned_target_sub_ = self.create_subscription(
            PoseStamped,
            "/control/trajectory_controller/planned_target",
            self.on_planned_target_msg,
            qos_profile=qos
        )

        self.planned_trajectory_sub_ = self.create_subscription(
            Path,
            "/control/trajectory_controller/planned_trajectory",
            self.on_planned_trajectory_msg,
            qos_profile=qos
        )

        self.battery_voltage_sub_ = self.create_subscription(
            Float32,
            "/payload/charger_gripper/battery_voltage",
            self.on_battery_voltage_msg,
            qos_profile=qos
        )

        self.charging_power_sub_ = self.create_subscription(
            Float32,
            "/payload/charger_gripper/charging_power",
            self.on_charging_power_msg,
            qos_profile=qos
        )

        self.charger_operating_mode_sub_ = self.create_subscription(
            ChargerOperatingMode,
            "/payload/charger_gripper/charger_operating_mode",
            self.on_charger_operating_mode_msg,
            qos_profile=qos
        )

        self.charger_status_sub_ = self.create_subscription(
            ChargerStatus,
            "/payload/charger_gripper/charger_status",
            self.on_charger_status_msg,
            qos_profile=qos
        )

        self.gripper_status_sub_ = self.create_subscription(
            GripperStatus,
            "/payload/charger_gripper/gripper_status",
            self.on_gripper_status_msg,
            qos_profile=qos
        )

        self.cont_mission_orch_state_sub_ = self.create_subscription(
            String,
            "/mission/continuous_mission_orchestrator/state",
            self.on_cont_mission_orch_state_msg,
            qos_profile=qos
        )

        self.current_action = "None"
        self.action_status = "Idle"
        
    def add_on_set_parameter_event_callback(self, callback):
        self._on_set_parameter_callback = callback

    def on_pl_msg(self, msg: Powerline):
        if self.pl_lock_.acquire(blocking=True):
            self.powerline_tuples_ = []
            self.powerline_quat_ = None

            for i in range(len(msg.lines)):
                line: "SingleLine" = msg.lines[i]
                pose = line.pose
                id = line.id
                point = [
                    pose.position.x,
                    pose.position.y,
                    pose.position.z
                ]
                self.powerline_tuples_.append((id, point))

                if (self.powerline_quat_ is None):
                    self.powerline_quat_ = [
                        pose.orientation.w,
                        pose.orientation.x,
                        pose.orientation.y,
                        pose.orientation.z
                    ]

            self.pl_lock_.release()

    def on_state_msg(self, msg: ControlState):
        if self.control_state_lock_.acquire(blocking=True):
            if msg.state == ControlState.CONTROL_STATE_INIT:
                self.control_state_ = "init"
            elif msg.state == ControlState.CONTROL_STATE_ON_GROUND_NON_OFFBOARD:
                self.control_state_ = "on ground non offboard"
            elif msg.state == ControlState.CONTROL_STATE_IN_FLIGHT_NON_OFFBOARD:
                self.control_state_ = "in flight non offboard"
            elif msg.state == ControlState.CONTROL_STATE_ARMING:
                self.control_state_ = "arming"
            elif msg.state == ControlState.CONTROL_STATE_SETTING_OFFBOARD:
                self.control_state_ = "setting offboard"
            elif msg.state == ControlState.CONTROL_STATE_TAKING_OFF:
                self.control_state_ = "taking off"
            elif msg.state == ControlState.CONTROL_STATE_HOVERING:
                self.control_state_ = "hovering"
            elif msg.state == ControlState.CONTROL_STATE_LANDING:
                self.control_state_ = "landing"
            elif msg.state == ControlState.CONTROL_STATE_IN_POSITIONAL_FLIGHT:
                self.control_state_ = "in positional flight"
            elif msg.state == ControlState.CONTROL_STATE_DURING_CABLE_LANDING:
                self.control_state_ = "during cable landing"
            elif msg.state == ControlState.CONTROL_STATE_ON_CABLE_ARMED:
                self.control_state_ = "on cable armed"
            elif msg.state == ControlState.CONTROL_STATE_DURING_CABLE_TAKEOFF:
                self.control_state_ = "during cable takeoff"
            elif msg.state == ControlState.CONTROL_STATE_HOVERING_UNDER_CABLE:
                self.control_state_ = "hovering under cable"
            elif msg.state == ControlState.CONTROL_STATE_FLYING_ALONG_CABLE:
                self.control_state_ = "flying along cable"
            elif msg.state == ControlState.CONTROL_STATE_DISARMING_ON_CABLE:
                self.control_state_ = "disarming on cable"
            elif msg.state == ControlState.CONTROL_STATE_ON_CABLE_DISARMED:
                self.control_state_ = "on cable disarmed"
            elif msg.state == ControlState.CONTROL_STATE_ARMING_ON_CABLE:
                self.control_state_ = "arming on cable"
            elif msg.state == ControlState.CONTROL_STATE_SETTING_OFFBOARD_ON_CABLE:
                self.control_state_ = "setting offboard on cable"
            else:
                self.control_state_ = "unknown"

            self.control_state_lock_.release()

    def on_target_cable_id_msg(self, msg: Int16):
        if self.target_cable_id_lock_.acquire(blocking=True):
            self.target_cable_id_ = msg.data if msg.data >= 0 else None
            self.target_cable_id_lock_.release()

    def on_planned_target_msg(self, msg: PoseStamped):
        if self.target_lock_.acquire(blocking=True):
            self.target = msg
            self.target_lock_.release()

    def on_planned_trajectory_msg(self, msg: Path):
        if self.traj_lock_.acquire(blocking=True):
            self.traj = msg
            self.traj_lock_.release()

    def on_battery_voltage_msg(self, msg: Float32):
        if self.battery_voltage_lock_.acquire(blocking=True):
            self.battery_voltage_ = msg.data
            self.battery_voltage_lock_.release()

    def on_charging_power_msg(self, msg: Float32):
        if self.charging_power_lock_.acquire(blocking=True):
            self.charging_power_ = msg.data
            self.charging_power_lock_.release()

    def on_charger_operating_mode_msg(self, msg: ChargerOperatingMode):
        if self.charger_operating_mode_lock_.acquire(blocking=True):
            self.charger_operating_mode_ = msg
            self.charger_operating_mode_lock_.release()

    def on_charger_status_msg(self, msg: ChargerStatus):
        if self.charger_status_lock_.acquire(blocking=True):
            self.charger_status_ = msg
            self.charger_status_lock_.release()

    def on_gripper_status_msg(self, msg: GripperStatus):
        if self.gripper_status_lock_.acquire(blocking=True):
            self.gripper_status_ = msg
            self.gripper_status_lock_.release()

    def on_cont_mission_orch_state_msg(self, msg: String):
        if self.cont_mission_orch_state_lock_.acquire(blocking=True):
            self.cont_mission_orch_state = msg.data
            self.cont_mission_orch_state_lock_.release()

    def get_target_cable_id(self):
        if self.target_cable_id_lock_.acquire(blocking=True):
            id = self.target_cable_id_
            self.target_cable_id_lock_.release()
            return id

    def get_battery_voltage(self):
        if self.battery_voltage_lock_.acquire(blocking=True):
            voltage = self.battery_voltage_
            self.battery_voltage_lock_.release()
            return voltage
        
    def get_charging_power(self):
        if self.charging_power_lock_.acquire(blocking=True):
            power = self.charging_power_
            self.charging_power_lock_.release()
            return power
        
    def get_charger_operating_mode(self):
        if self.charger_operating_mode_lock_.acquire(blocking=True):
            mode = self.charger_operating_mode_
            self.charger_operating_mode_lock_.release()
            return mode
        
    def get_charger_status(self):
        if self.charger_status_lock_.acquire(blocking=True):
            status = self.charger_status_
            self.charger_status_lock_.release()
            return status

    def get_gripper_status(self) -> GripperStatus:
        if self.gripper_status_lock_.acquire(blocking=True):
            status = self.gripper_status_
            self.gripper_status_lock_.release()
            return status

    def get_img(self):
        img = None
        
        if self.img_lock_.acquire(blocking=True):
            img = self.img_
            self.img_lock_.release()
            
        return img

    def get_control_state(self):
        state = "unknown"
        
        if (self.control_state_lock_.acquire(blocking=True)):
            state = self.control_state_
            self.control_state_lock_.release()
            
        return state

    def get_target(self):
        target = None
        
        if (self.target_lock_.acquire(blocking=True)):
            if self.target is not None:
                drone_frame_id = self.get_parameter("drone_frame_id").value
                world_frame_id = self.get_parameter("world_frame_id").value
                try:
                    tf = self.tf_buffer.lookup_transform(drone_frame_id, world_frame_id, rclpy.time.Time())
                except Exception:
                    return None

                quat = np.array([tf.transform.rotation.w, tf.transform.rotation.x, tf.transform.rotation.y, tf.transform.rotation.z])
                trans = np.array([tf.transform.translation.x, tf.transform.translation.y, tf.transform.translation.z])
                rotm = quatToMat(quat)

                target = np.array([self.target.pose.position.x, self.target.pose.position.y, self.target.pose.position.z])

                target = np.matmul(rotm, target) + trans

            self.target_lock_.release()
            
        return target

    def get_trajectory(self):
        traj = []
        
        if (self.traj_lock_.acquire(blocking=True)):
            if self.traj is not None:
                drone_frame_id = self.get_parameter("drone_frame_id").value
                world_frame_id = self.get_parameter("world_frame_id").value
                tf = self.tf_buffer.lookup_transform(drone_frame_id, world_frame_id, rclpy.time.Time())

                quat = np.array([tf.transform.rotation.w, tf.transform.rotation.x, tf.transform.rotation.y, tf.transform.rotation.z])
                trans = np.array([tf.transform.translation.x, tf.transform.translation.y, tf.transform.translation.z])
                rotm = quatToMat(quat)

                for i in range(len(self.traj.poses)):
                    p = np.array([self.traj.poses[i].pose.position.x, self.traj.poses[i].pose.position.y, self.traj.poses[i].pose.position.z])
                    p = np.matmul(rotm,p) + trans
                    traj.append(p)

            self.traj_lock_.release()
            
        return traj

    def get_action_status(self):
        current_action, action_status = "None", "Idle"

        if self.action_status_lock_.acquire(blocking=True):
            current_action = self.current_action
            action_status = self.action_status
            self.action_status_lock_.release()

        return current_action, action_status

    def get_cable_ids(self):       
        self.pl_lock_.acquire(blocking=True)
        ids = [self.powerline_tuples_[i][0] for i in range(len(self.powerline_tuples_))]
        self.pl_lock_.release()

        return ids

    def get_cont_mission_orch_state(self):
        state = "unknown"

        if self.cont_mission_orch_state_lock_.acquire(blocking=True):
            state = self.cont_mission_orch_state
            self.cont_mission_orch_state_lock_.release()

        return state

    def send_takeoff_action_request(self, takeoff_height):
        print("Sending takeoff action request with height: "+str(takeoff_height))

        if self.action_status_lock_.acquire(blocking=True):
            self.current_action = "Takeoff"
            self.action_status = "Waiting for reply"
            self.action_status_lock_.release()

        goal_msg = Takeoff.Goal()
        goal_msg.target_altitude = takeoff_height
        
        if not self.takeoff_client.wait_for_server(timeout_sec=1.0):
            if self.action_status_lock_.acquire(blocking=True):
                self.action_status = "Cancelled"
                self.action_status_lock_.release()
        
        self.future = self.takeoff_client.send_goal_async(goal_msg)
        self.future.add_done_callback(self.goal_response_callback)

    def send_landing_action_request(self):
        print("Sending landing action request")

        if self.action_status_lock_.acquire(blocking=True):
            self.current_action = "Landing"
            self.action_status = "Waiting for reply"
            self.action_status_lock_.release()

        goal_msg = Landing.Goal()
        
        if not self.landing_client.wait_for_server(timeout_sec=1.):
            if self.action_status_lock_.acquire(blocking=True):
                self.action_status = "Cancelled"
                self.action_status_lock_.release()
        
        self.future = self.landing_client.send_goal_async(goal_msg)
        self.future.add_done_callback(self.goal_response_callback)
        self.action_client = self.landing_client

    def send_fly_to_position_action_request(self, target_pose):
        print("Sending fly-to-position action request with target pose:", target_pose)

        if self.action_status_lock_.acquire(blocking=True):
            self.current_action = "FlyToPosition"
            self.action_status = "Waiting for reply"
            self.action_status_lock_.release()

        goal_msg = FlyToPosition.Goal()
        goal_msg.target_pose = target_pose
        
        if not self.fly_to_position_client.wait_for_server(timeout_sec=1.0):
            if self.action_status_lock_.acquire(blocking=True):
                self.action_status = "Cancelled"
                self.action_status_lock_.release()
        
        self.future = self.fly_to_position_client.send_goal_async(goal_msg)
        self.future.add_done_callback(self.goal_response_callback)
        self.action_client = self.fly_to_position_client

    def send_fly_under_cable_action_request(self, cable_id, target_distance):
        print("Sending fly-under-cable action request with cable id", cable_id, "and target distance", target_distance)

        if self.action_status_lock_.acquire(blocking=True):
            self.current_action = "FlyUnderCable"
            self.action_status = "Waiting for reply"
            self.action_status_lock_.release()

        goal_msg = FlyUnderCable.Goal()
        goal_msg.target_cable_id = cable_id
        goal_msg.target_cable_distance = target_distance
        
        if not self.fly_under_cable_client.wait_for_server(timeout_sec=1.0):
            if self.action_status_lock_.acquire(blocking=True):
                self.action_status = "Cancelled"
                self.action_status_lock_.release()
        
        self.future = self.fly_under_cable_client.send_goal_async(goal_msg)
        self.future.add_done_callback(self.goal_response_callback)
        self.action_client = self.fly_under_cable_client

    def send_cable_landing_action_request(self, target_cable_id):
        print("Sending cable landing action request with target cable id:", target_cable_id)

        if self.action_status_lock_.acquire(blocking=True):
            self.current_action = "CableLanding"
            self.action_status = "Waiting for reply"
            self.action_status_lock_.release()

        goal_msg = CableLanding.Goal()
        goal_msg.target_cable_id = target_cable_id
        
        if not self.cable_landing_client.wait_for_server(timeout_sec=1.0):
            if self.action_status_lock_.acquire(blocking=True):
                self.action_status = "Cancelled"
                self.action_status_lock_.release()
        
        self.future = self.cable_landing_client.send_goal_async(goal_msg)
        self.future.add_done_callback(self.goal_response_callback)
        self.action_client = self.cable_landing_client

    def send_cable_takeoff_action_request(self, target_cable_distance):
        print("Sending cable takeoff action request with target cable distance:", target_cable_distance)

        if self.action_status_lock_.acquire(blocking=True):
            self.current_action = "CableTakeoff"
            self.action_status = "Waiting for reply"
            self.action_status_lock_.release()

        goal_msg = CableTakeoff.Goal()
        goal_msg.target_cable_distance = target_cable_distance
        
        if not self.cable_takeoff_client.wait_for_server(timeout_sec=1.0):
            if self.action_status_lock_.acquire(blocking=True):
                self.action_status = "Cancelled"
                self.action_status_lock_.release()
        
        self.future = self.cable_takeoff_client.send_goal_async(goal_msg)
        self.future.add_done_callback(self.goal_response_callback)
        self.action_client = self.cable_takeoff_client

    def send_disarm_on_cable_action_request(self):
        print("Sending disarm on cable action request")

        if self.action_status_lock_.acquire(blocking=True):
            self.current_action = "DisarmOnCable"
            self.action_status = "Waiting for reply"
            self.action_status_lock_.release()

        goal_msg = DisarmOnCable.Goal()
        
        if not self.disarm_on_cable_client.wait_for_server(timeout_sec=1.0):
            if self.action_status_lock_.acquire(blocking=True):
                self.action_status = "Cancelled"
                self.action_status_lock_.release()
        
        self.future = self.disarm_on_cable_client.send_goal_async(goal_msg)
        self.future.add_done_callback(self.goal_response_callback)
        self.action_client = self.disarm_on_cable_client

    def send_arm_on_cable_action_request(self):
        print("Sending arm on cable action request")

        if self.action_status_lock_.acquire(blocking=True):
            self.current_action = "ArmOnCable"
            self.action_status = "Waiting for reply"
            self.action_status_lock_.release()

        goal_msg = ArmOnCable.Goal()
        
        if not self.arm_on_cable_client.wait_for_server(timeout_sec=1.0):
            if self.action_status_lock_.acquire(blocking=True):
                self.action_status = "Cancelled"
                self.action_status_lock_.release()
        
        self.future = self.arm_on_cable_client.send_goal_async(goal_msg)
        self.future.add_done_callback(self.goal_response_callback)
        self.action_client = self.arm_on_cable_client

    def goal_response_callback(self, future):
        self.goal_handle = future.result()
        self.action_status_lock_.acquire(blocking=True)
        if not self.goal_handle.accepted:
            self.action_status = "Cancelled"
            self.action_status_lock_.release()
            return

        self.action_status = "Executing"
        self.action_status_lock_.release()

        self.future = self.goal_handle.get_result_async()
        self.future.add_done_callback(self.get_result_callback)

    def get_result_callback(self, future):
        res = future.result()
        
        self.action_status_lock_.acquire(blocking=True)
        if res is None or not res.result.success:
            self.action_status = "Cancelled"
            self.action_status_lock_.release()
            return

        self.action_status = "Success"
        self.action_status_lock_.release()

    def send_open_gripper_command(self):
        print("Sending open gripper command")

        if self.action_status_lock_.acquire(blocking=True):
            self.current_action = "OpenGripper"
            self.action_status = "Waiting for reply"
            self.action_status_lock_.release()

        gripper_status = self.get_gripper_status()

        if gripper_status.gripper_status != GripperStatus.GRIPPER_STATUS_CLOSED:
            return
        
        if not self.gripper_command_srv_client.wait_for_service(timeout_sec=1.0):
            if self.action_status_lock_.acquire(blocking=True):
                self.action_status = "Cancelled"
                self.action_status_lock_.release()

        req = GripperCommand.Request()
        req.gripper_command = GripperCommand.Request.GRIPPER_COMMAND_OPEN

        future = self.gripper_command_srv_client.call_async(req)
        future.add_done_callback(self.gripper_command_response_callback)

    def send_close_gripper_command(self):
        print("Sending close gripper command")

        if self.action_status_lock_.acquire(blocking=True):
            self.current_action = "CloseGripper"
            self.action_status = "Waiting for reply"
            self.action_status_lock_.release()

        gripper_status = self.get_gripper_status()

        if gripper_status.gripper_status != GripperStatus.GRIPPER_STATUS_OPEN:
            return
        
        if not self.gripper_command_srv_client.wait_for_service(timeout_sec=1.0):
            if self.action_status_lock_.acquire(blocking=True):
                self.action_status = "Cancelled"
                self.action_status_lock_.release()

        req = GripperCommand.Request()
        req.gripper_command = GripperCommand.Request.GRIPPER_COMMAND_CLOSE

        future = self.gripper_command_srv_client.call_async(req)
        future.add_done_callback(self.gripper_command_response_callback)

    def gripper_command_response_callback(self, future: rclpy.Future):
        response: GripperCommand.Response = future.result()

        if response.gripper_command_response != GripperCommand.Response.GRIPPER_COMMAND_RESPONSE_SUCCESS:
            if self.action_status_lock_.acquire(blocking=True):
                self.action_status = "Cancelled"
                self.action_status_lock_.release()

        else:
            if self.action_status_lock_.acquire(blocking=True):
                self.action_status = "Success"
                self.action_status_lock_.release()

    def set_target_cable_id(self, cable_id):
        print("Setting target cable id: " + str(cable_id))

        if self.action_status_lock_.acquire(blocking=True):
            self.current_action = "SetTargetCableId"
            self.action_status = "Waiting for reply"
            self.action_status_lock_.release()

        if not self.set_target_cable_id_srv_client.wait_for_service(timeout_sec=1.0):
            if self.action_status_lock_.acquire(blocking=True):
                self.action_status = "Cancelled"
                self.action_status_lock_.release()

        req = SetTargetCableId.Request()
        req.target_cable_id = cable_id

        future = self.set_target_cable_id_srv_client.call_async(req)
        future.add_done_callback(self.set_target_cable_id_response_callback)

    def set_target_cable_id_response_callback(self, future: rclpy.Future):
        response: SetTargetCableId.Response = future.result()

        if self.action_status_lock_.acquire(blocking=True):
            self.action_status = "Success"
            self.action_status_lock_.release()

    def initiate_charging(self):
        print("Initiating charging")

        if self.action_status_lock_.acquire(blocking=True):
            self.current_action = "InitiateCharging"
            self.action_status = "Waiting for reply"
            self.action_status_lock_.release()

        if not self.initiate_charging_srv_client.wait_for_service(timeout_sec=1.0):
            if self.action_status_lock_.acquire(blocking=True):
                self.action_status = "Cancelled"
                self.action_status_lock_.release()

        req = InitiateCharging.Request()

        future = self.initiate_charging_srv_client.call_async(req)
        future.add_done_callback(self.initiate_charging_response_callback)

    def initiate_charging_response_callback(self, future: rclpy.Future):
        response: InitiateCharging.Response = future.result()

        if self.action_status_lock_.acquire(blocking=True):
            if response.success:
                self.action_status = "Success"
            else:
                self.action_status = "Cancelled"
                
            self.action_status_lock_.release()

    def interrupt_charging(self):
        print("Interrupting charging")

        if self.action_status_lock_.acquire(blocking=True):
            self.current_action = "InterruptCharging"
            self.action_status = "Waiting for reply"
            self.action_status_lock_.release()

        if not self.interrupt_charging_srv_client.wait_for_service(timeout_sec=1.0):
            if self.action_status_lock_.acquire(blocking=True):
                self.action_status = "Cancelled"
                self.action_status_lock_.release()

        req = InterruptCharging.Request()

        future = self.interrupt_charging_srv_client.call_async(req)
        future.add_done_callback(self.interrupt_charging_response_callback)

    def interrupt_charging_response_callback(self, future: rclpy.Future):
        response: InterruptCharging.Response = future.result()

        if self.action_status_lock_.acquire(blocking=True):
            if response.success:
                self.action_status = "Success"
            else:
                self.action_status = "Cancelled"
                
            self.action_status_lock_.release()

    def prolong_charging_until_interrupted(self):
        print("Prolonging charging until interrupted")

        if self.action_status_lock_.acquire(blocking=True):
            self.current_action = "ProlongCharging"
            self.action_status = "Waiting for reply"
            self.action_status_lock_.release()

        if not self.prolong_charging_srv_client.wait_for_service(timeout_sec=1.0):
            if self.action_status_lock_.acquire(blocking=True):
                self.action_status = "Cancelled"
                self.action_status_lock_.release()

        req = ProlongCharging.Request()
        req.prolong_mode = ProlongCharging.Request.PROLONG_MODE_UNTIL_INTERRUPTED

        future = self.prolong_charging_srv_client.call_async(req)
        future.add_done_callback(self.prolong_charging_response_callback)

    def prolong_charging_clear(self):
        print("Prolonging charging clear")

        if self.action_status_lock_.acquire(blocking=True):
            self.current_action = "ProlongCharging"
            self.action_status = "Waiting for reply"
            self.action_status_lock_.release()

        if not self.prolong_charging_srv_client.wait_for_service(timeout_sec=1.0):
            if self.action_status_lock_.acquire(blocking=True):
                self.action_status = "Cancelled"
                self.action_status_lock_.release()

        req = ProlongCharging.Request()
        req.prolong_mode = ProlongCharging.Request.PROLONG_MODE_CLEAR

        future = self.prolong_charging_srv_client.call_async(req)
        future.add_done_callback(self.prolong_charging_response_callback)

    def prolong_charging_response_callback(self, future: rclpy.Future):
        response: ProlongCharging.Response = future.result()

        if self.action_status_lock_.acquire(blocking=True):
            if response.success:
                self.action_status = "Success"
            else:
                self.action_status = "Cancelled"
                
            self.action_status_lock_.release()

    def cancel_action(self):
        self.action_client._cancel_goal(self.goal_handle)
        
    def get_parameter_yaml(self) -> str:
        print("Getting parameter yaml")

        if not self.get_parameter_yaml_srv_client.wait_for_service(timeout_sec=5.0):
            raise Exception("Configuration server not available")

        req = GetParameterYaml.Request()
        
        future = self.get_parameter_yaml_srv_client.call_async(req)
        
        while not future.done():
            rclpy.spin_once(self)
        
        response: "GetParameterYaml.Response" = future.result()
        
        return response.yaml
    
    def get_declared_parameters(self) -> dict:
        print("Getting declared parameters")

        if not self.get_declared_parameters_srv_client.wait_for_service(timeout_sec=5.0):
            raise Exception("Configuration server not available")

        req = GetDeclaredParameters.Request()
        
        future = self.get_declared_parameters_srv_client.call_async(req)
        
        while not future.done():
            rclpy.spin_once(self)
        
        response: "GetDeclaredParameters.Response" = future.result()
        
        return yaml.safe_load(response.declared_parameters_yaml)
    
    def save_parameters_remote(
        self,
        file: str,
        set_as_default: bool = True,
        overwrite: bool = False
    ) -> "tuple[bool|str]":
        print("Saving parameters remotely")

        if not self.save_parameters_srv_client.wait_for_service(timeout_sec=5.0):
            raise Exception("Configuration server not available")

        req = SaveParameters.Request()
        req.file = file
        req.set_as_default = set_as_default
        req.overwrite = overwrite
        
        future = self.save_parameters_srv_client.call_async(req)
        
        while not future.done():
            rclpy.spin_once(self)
        
        response: "SaveParameters.Response" = future.result()

        if not response.success:
            print("Saving parameters remotely failed with message:", response.message)
        else:
            print("Saving parameters remotely succeeded")
        
        return response.success, response.file, response.message
    
    def get_parameter_files_remote(self) -> list:
        print("Getting parameter files remotely")

        if not self.get_parameter_files_srv_client.wait_for_service(timeout_sec=5.0):
            raise Exception("Configuration server not available")

        req = GetParameterFiles.Request()
        
        future = self.get_parameter_files_srv_client.call_async(req)
        
        while not future.done():
            rclpy.spin_once(self)
        
        response: "GetParameterFiles.Response" = future.result()
        
        return response.parameter_files
    
    def load_parameters_remote(
        self,
        file: str,
        set_as_default: bool = True,
        overwrite: bool = False
    ) -> "tuple[bool|str]":
        print("Loading parameters remotely")

        if not self.load_parameters_srv_client.wait_for_service(timeout_sec=5.0):
            raise Exception("Configuration server not available")

        req = LoadParameters.Request()
        req.file = file
        req.set_as_default = set_as_default
        
        future = self.load_parameters_srv_client.call_async(req)
        
        while not future.done():
            rclpy.spin_once(self)
        
        response: "LoadParameters.Response" = future.result()

        if not response.success:
            print("Loading parameters remotely failed with message:", response.message)
        else:
            print("Loading parameters remotely succeeded")
        
        return response.success, response.message
    
    def set_parameter_from_gc_remote(
        self,
        name: str,
        value: str,
    ) -> "tuple[bool|str]":
        print("Setting parameter from ground control remotely")
        
        if not self.set_parameter_from_gc_srv_client.wait_for_service(timeout_sec=5.0):
            raise Exception("Configuration server not available")
        
        req = SetParameterFromGC.Request()
        req.parameter_name = name
        req.parameter_string_value = str(value)
        
        future = self.set_parameter_from_gc_srv_client.call_async(req)
        
        while not future.done():
            rclpy.spin_once(self)
            
        response: "SetParameterFromGC.Response" = future.result()
        
        if not response.success:
            print("Setting parameter from ground control remotely failed with message:", response.message)
            
        else:
            print("Setting parameter from ground control remotely succeeded")
            
        return response.success, response.message
    
    def get_current_parameter_file(
        self,
    ) -> "str":
        print("Getting current parameter file")
        
        if not self.get_current_parameter_file_srv_client.wait_for_service(timeout_sec=5.0):
            raise Exception("Configuration server not available")
        
        req = GetCurrentParameterFile.Request()
        
        future = self.get_current_parameter_file_srv_client.call_async(req)
        
        while not future.done():
            rclpy.spin_once(self)
            
        response: "GetCurrentParameterFile.Response" = future.result()
        
        return response.current_parameter_file
    
    def on_parameter_event(self, msg: ParameterEvent):
        if self._on_set_parameter_callback is not None:
            for param in msg.changed_parameters:
                param: Parameter
                self._on_set_parameter_callback(
                    param.name,
                    param.value
                )
