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
from iii_drone_interfaces.msg import (
    CombinedDroneAwareness,
    Maneuver,
    Target,
    StringStamped,
    Powerline,
    ChargerOperatingMode,
    ChargerStatus,
    GripperStatus,
    PLMapperCommand as PLMapperCommandMsg
    
)
from iii_drone_interfaces.srv import GripperCommand
from iii_drone_interfaces.srv import PLMapperCommand, UpdatePowerlineOverview
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

        # self.declare_parameter("takeoff_height_default", 1.0)
        # self.declare_parameter("target_cable_distance_default", 1.5)

        # self.declare_parameter("config_file_path", "III-Drone-ROS2-pkg/config/params.yaml")
        # self.config_file_path = self.get_parameter("config_file_path").value
        # self.config_file_path = "/home/" + os.getenv("USER") + "/.config/iii_drone/params.yaml"

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
        
        self.current_action = "None"
        self.action_status = "None"
        self.action_status_lock_ = Lock()
        
        self.powerline_tuples_ = [] # (id, point)
        self.powerline_quat_ = None
        
        self.pl_lock_ = Lock()
        self.combined_drone_awareness_lock_ = Lock()
        self.current_maneuver_lock_ = Lock()
        self.target_lock_ = Lock()
        self.target_pose_lock_ = Lock()
        self.traj_lock_ = Lock()
        self.reference_mode_lock_ = Lock()
        self.battery_voltage_lock_ = Lock()
        self.charging_power_lock_ = Lock()
        self.charger_operating_mode_lock_ = Lock()
        self.charger_status_lock_ = Lock()
        self.gripper_status_lock_ = Lock()
        self.pl_mapper_state_lock_ = Lock()
        self.pl_dir_computer_status_lock_ = Lock()
        self.hough_transformer_status_lock_ = Lock()
        self.stored_powerline_status_lock_ = Lock()

        self.img_ = None
        self.combined_drone_awareness = None
        self.current_maneuver = None
        self.target = None
        self.target_pose = None
        self.traj = None
        self.reference_mode = None
        self.pl = None
        self.powerline_tuples_ = []
        self.powerline_quat_ = None

        self.battery_voltage_ = -1
        self.charging_power_ = -1

        self.charger_operating_mode_ = ChargerOperatingMode()
        self.charger_operating_mode_.operating_mode = 0

        self.charger_status_ = ChargerStatus()
        self.charger_status_.charger_status = 0

        self.gripper_status_ = GripperStatus()
        self.gripper_status_.gripper_status = GripperStatus.GRIPPER_STATUS_OPEN

        self.pl_mapper_state = None
        self.pl_dir_computer_status = None
        self.hough_transformer_status = None
        self.stored_powerline_status_ = None

        self.gripper_command_srv_client = self.create_client(GripperCommand, "/payload/charger_gripper/gripper_command")

        self.pl_mapper_command_srv_client = self.create_client(PLMapperCommand, "/perception/pl_mapper/pl_mapper_command")

        self.update_powerline_overview_srv_client = self.create_client(UpdatePowerlineOverview, "/mission/powerline_overview_provider/update_powerline_overview")

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

        self.combined_drone_awareness_sub_ = self.create_subscription(
            CombinedDroneAwareness,
            "/control/maneuver_controller/combined_drone_awareness",
            self.on_combined_drone_awareness_msg,
            qos_profile=qos
        )
        
        self.current_maneuver_sub_ = self.create_subscription(
            Maneuver,
            "/control/maneuver_controller/current_maneuver",
            self.on_current_maneuver_msg,
            qos_profile=qos
        )
        
        self.target_sub_ = self.create_subscription(
            Target,
            "/control/maneuver_controller/target",
            self.on_target_msg,
            qos_profile=qos
        )
        
        self.target_pose_sub_ = self.create_subscription(
            PoseStamped,
            "/control/trajectory_controller/target_pose",
            self.on_target_pose_msg,
            qos_profile=qos
        )

        self.trajectory_path_sub_ = self.create_subscription(
            Path,
            "/control/trajectory_controller/trajectory_path",
            self.on_trajectory_path_msg,
            qos_profile=qos
        )

        self.reference_mode_sub_ = self.create_subscription(
            StringStamped,
            "/mission/mission_executor/maneuver_reference_client/reference_mode",
            self.on_reference_mode_msg,
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

        self.pl_sub_ = self.create_subscription(
            Powerline,
            "/perception/pl_mapper/powerline",
            self.on_pl_msg,
            qos_profile=qos
        )

        self.pl_mapper_state_sub_ = self.create_subscription(
            StringStamped,
            "/perception/pl_mapper/state",
            self.on_pl_mapper_state_msg,
            qos_profile=qos
        )
        
        self.pl_dir_computer_status_sub_ = self.create_subscription(
            StringStamped,
            "/perception/pl_dir_computer/status",
            self.on_pl_dir_computer_status_msg,
            qos_profile=qos
        )
        
        self.hough_transformer_status_sub_ = self.create_subscription(
            StringStamped,
            "/perception/hough_transformer/status",
            self.on_hough_transformer_status_msg,
            qos_profile=qos
        )

        self.stored_powerline_status_sub_ = self.create_subscription(
            StringStamped,
            "/mission/powerline_overview_provider/stored_powerline_status",
            self.on_stored_powerline_status_msg,
            qos_profile=qos
        )

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

    def on_combined_drone_awareness_msg(self, msg: CombinedDroneAwareness):
        if self.combined_drone_awareness_lock_.acquire(blocking=True):
            self.combined_drone_awareness = msg
            self.combined_drone_awareness_lock_.release()
            
    def on_current_maneuver_msg(self, msg: Maneuver):
        if self.current_maneuver_lock_.acquire(blocking=True):
            self.current_maneuver = msg
            self.current_maneuver_lock_.release()
            
    def on_target_msg(self, msg: Target):
        if self.target_lock_.acquire(blocking=True):
            self.target = msg
            self.target_lock_.release()
            
    def on_target_pose_msg(self, msg: PoseStamped):
        if self.target_pose_lock_.acquire(blocking=True):
            self.target_pose = msg
            self.target_pose_lock_.release()
            
    def on_trajectory_path_msg(self, msg: Path):
        if self.traj_lock_.acquire(blocking=True):
            self.traj = msg
            self.traj_lock_.release()
            
    def on_reference_mode_msg(self, msg: StringStamped):
        if self.reference_mode_lock_.acquire(blocking=True):
            self.reference_mode = msg
            self.reference_mode_lock_.release()
            
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

    def on_pl_mapper_state_msg(self, msg: StringStamped):
        if self.pl_mapper_state_lock_.acquire(blocking=True):
            self.pl_mapper_state = msg
            self.pl_mapper_state_lock_.release()
            
    def on_pl_dir_computer_status_msg(self, msg: StringStamped):
        if self.pl_dir_computer_status_lock_.acquire(blocking=True):
            self.pl_dir_computer_status = msg
            self.pl_dir_computer_status_lock_.release()
            
    def on_hough_transformer_status_msg(self, msg: StringStamped):
        if self.hough_transformer_status_lock_.acquire(blocking=True):
            self.hough_transformer_status = msg
            self.hough_transformer_status_lock_.release()

    def on_stored_powerline_status_msg(self, msg: StringStamped):
        if self.stored_powerline_status_lock_.acquire(blocking=True):
            self.stored_powerline_status_ = msg
            self.stored_powerline_status_lock_.release()
            
    def get_stored_powerline_status(self):
        if self.stored_powerline_status_lock_.acquire(blocking=True):
            status = self.stored_powerline_status_
            self.stored_powerline_status_lock_.release()
            
            if status:
                return status.data
            
        return "Unknown"
            
    def get_pl_mapper_state(self):
        if self.pl_mapper_state_lock_.acquire(blocking=True):
            state = self.pl_mapper_state
            self.pl_mapper_state_lock_.release()
            
            if state:
                return state.data
            
        return "Unknown"
    
    def get_pl_dir_computer_status(self):
        if self.pl_dir_computer_status_lock_.acquire(blocking=True):
            status = self.pl_dir_computer_status
            self.pl_dir_computer_status_lock_.release()
            
            if status:
                return status.data
            
        return "Unknown"
    
    def get_hough_transformer_status(self):
        if self.hough_transformer_status_lock_.acquire(blocking=True):
            status = self.hough_transformer_status
            self.hough_transformer_status_lock_.release()
            
            if status:
                return status.data
            
        return "Unknown"
            
    def get_combined_drone_awareness(self):
        if self.combined_drone_awareness_lock_.acquire(blocking=True):
            msg = self.combined_drone_awareness
            self.combined_drone_awareness_lock_.release()
            return msg

    def get_drone_location(self):
        combined_drone_awareness = self.get_combined_drone_awareness()
        
        if combined_drone_awareness is not None:
            if combined_drone_awareness.drone_location == 0:
                return "Unknown"
            elif combined_drone_awareness.drone_location == 1:
                return "On ground"
            elif combined_drone_awareness.drone_location == 2:
                return "In flight"
            elif combined_drone_awareness.drone_location == 3:
                return "On cable"
            
        return "Unknown"
    
    def get_armed(self):
        combined_drone_awareness = self.get_combined_drone_awareness()
        
        if combined_drone_awareness is not None:
            return combined_drone_awareness.armed
            
        return False
    
    def get_offboard(self):
        combined_drone_awareness = self.get_combined_drone_awareness()
        
        if combined_drone_awareness is not None:
            return combined_drone_awareness.offboard
            
        return False
    
    def get_target_position_known(self):
        combined_drone_awareness = self.get_combined_drone_awareness()
        
        if combined_drone_awareness is not None:
            return combined_drone_awareness.target_position_known
            
        return False
    
    def get_has_target(self):
        combined_drone_awareness = self.get_combined_drone_awareness()
        
        if combined_drone_awareness is not None:
            return combined_drone_awareness.has_target
            
        return False
    
    def get_on_cable_id(self):
        combined_drone_awareness = self.get_combined_drone_awareness()
        
        if combined_drone_awareness is not None:
            return combined_drone_awareness.on_cable_id
            
        return -1
    
    def get_ground_altitude_estimate(self):
        combined_drone_awareness = self.get_combined_drone_awareness()
        
        if combined_drone_awareness is not None:
            return combined_drone_awareness.ground_altitude_estimate
            
        return -1
        
    def get_current_maneuver(self):
        if self.current_maneuver_lock_.acquire(blocking=True):
            msg = self.current_maneuver
            self.current_maneuver_lock_.release()
            return msg

    def get_current_maneuver_type(self):
        maneuver = self.get_current_maneuver()
        
        if maneuver is not None:
            if maneuver.maneuver_type == Maneuver.MANEUVER_TYPE_NONE:
                return "None"
            
            elif maneuver.maneuver_type == Maneuver.MANEUVER_TYPE_FLY_TO_POSITION:
                return "Fly to position"
        
            elif maneuver.maneuver_type == Maneuver.MANEUVER_TYPE_FLY_TO_OBJECT:
                return "Fly to object"

            elif maneuver.maneuver_type == Maneuver.MANEUVER_TYPE_CABLE_LANDING:
                return "Cable landing"
            elif maneuver.maneuver_type == Maneuver.MANEUVER_TYPE_CABLE_TAKEOFF:
                return "Cable takeoff"
            elif maneuver.maneuver_type == Maneuver.MANEUVER_TYPE_HOVER:
                return "Hover"
            elif maneuver.maneuver_type == Maneuver.MANEUVER_TYPE_HOVER_BY_OBJECT:
                return "Hover by object"
            elif maneuver.maneuver_type == Maneuver.MANEUVER_TYPE_HOVER_ON_CABLE:
                return "Hover on cable"
            
        return "None"
    
    def get_current_maneuver_status(self):
        maneuver = self.get_current_maneuver()
        
        if maneuver is not None:
            if not maneuver.terminated:
                return "Running"
            
            else:
                if maneuver.success:
                    return "Success"
                
                else:
                    return "Failed"
            
        return "None"
        
    def get_target(self):
        if self.target_lock_.acquire(blocking=True):
            msg = self.target
            self.target_lock_.release()
            return msg
        
    def get_reference_mode(self):
        if self.reference_mode_lock_.acquire(blocking=True):
            msg = self.reference_mode
            self.reference_mode_lock_.release()
            return msg

    def get_maneuver_reference_client_mode(self):
        reference_mode = self.get_reference_mode()
        
        if reference_mode is not None:
            return reference_mode.data
        
        return "None"
        
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

    # def get_img(self):
    #     img = None
        
    #     if self.img_lock_.acquire(blocking=True):
    #         img = self.img_
    #         self.img_lock_.release()
            
    #     return img

    def get_target_pose(self):
        target = None
        
        if (self.target_pose_lock_.acquire(blocking=True)):
            if self.target_pose is not None:
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

    def get_cable_ids(self):       
        self.pl_lock_.acquire(blocking=True)
        ids = [self.powerline_tuples_[i][0] for i in range(len(self.powerline_tuples_))]
        self.pl_lock_.release()

        return ids

    def get_action_status(self):
        if self.action_status_lock_.acquire(blocking=True):
            cur = self.current_action
            status = self.action_status
            
            self.action_status_lock_.release()
            
            return cur, status

    def send_open_gripper_command(self):
        print("Sending open gripper command")

        if self.action_status_lock_.acquire(blocking=True):
            self.current_action = "OpenGripper"
            self.action_status = "Waiting for reply"
            self.action_status_lock_.release()

        gripper_status = self.get_gripper_status()

        if not self.gripper_command_srv_client.wait_for_service(timeout_sec=1.0):
            if self.action_status_lock_.acquire(blocking=True):
                self.action_status = "Cancelled"
                self.action_status_lock_.release()

            return

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

        if not self.gripper_command_srv_client.wait_for_service(timeout_sec=1.0):
            if self.action_status_lock_.acquire(blocking=True):
                self.action_status = "Cancelled"
                self.action_status_lock_.release()
                
            return

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

    def send_start_pl_mapper_command(self, reset: bool):
        if self.action_status_lock_.acquire(blocking=True):
            self.current_action = "StartPLMapper"
            self.action_status = "Waiting for reply"
            self.action_status_lock_.release()
            
        if not self.pl_mapper_command_srv_client.wait_for_service(timeout_sec=1.0):
            if self.action_status_lock_.acquire(blocking=True):
                self.action_status = "Cancelled"
                self.action_status_lock_.release()

            return
        
        request = PLMapperCommand.Request()
        request.pl_mapper_cmd.reset = reset
        request.pl_mapper_cmd.command = PLMapperCommandMsg.PL_MAPPER_CMD_START
        
        future = self.pl_mapper_command_srv_client.call_async(request)
        future.add_done_callback(self.pl_mapper_command_response_callback)
        
    def send_stop_pl_mapper_command(self, reset: bool):
        if self.action_status_lock_.acquire(blocking=True):
            self.current_action = "StopPLMapper"
            self.action_status = "Waiting for reply"
            self.action_status_lock_.release()
            
        if not self.pl_mapper_command_srv_client.wait_for_service(timeout_sec=1.0):
            if self.action_status_lock_.acquire(blocking=True):
                self.action_status = "Cancelled"
                self.action_status_lock_.release()

            return
        
        request = PLMapperCommand.Request()
        request.pl_mapper_cmd.reset = reset
        request.pl_mapper_cmd.command = PLMapperCommandMsg.PL_MAPPER_CMD_STOP
        
        future = self.pl_mapper_command_srv_client.call_async(request)
        future.add_done_callback(self.pl_mapper_command_response_callback)
        
    def send_freeze_pl_mapper_command(self, reset):
        if self.action_status_lock_.acquire(blocking=True):
            self.current_action = "FreezePLMapper"
            self.action_status = "Waiting for reply"
            self.action_status_lock_.release()
            
        if not self.pl_mapper_command_srv_client.wait_for_service(timeout_sec=1.0):
            if self.action_status_lock_.acquire(blocking=True):
                self.action_status = "Cancelled"
                self.action_status_lock_.release()

            return
        
        request = PLMapperCommand.Request()
        request.pl_mapper_cmd.reset = reset
        request.pl_mapper_cmd.command = PLMapperCommandMsg.PL_MAPPER_CMD_FREEZE
        
        future = self.pl_mapper_command_srv_client.call_async(request)
        future.add_done_callback(self.pl_mapper_command_response_callback)
        
    def send_pause_pl_mapper_command(self, reset):
        if self.action_status_lock_.acquire(blocking=True):
            self.current_action = "PausePLMapper"
            self.action_status = "Waiting for reply"
            self.action_status_lock_.release()
            
        if not self.pl_mapper_command_srv_client.wait_for_service(timeout_sec=1.0):
            if self.action_status_lock_.acquire(blocking=True):
                self.action_status = "Cancelled"
                self.action_status_lock_.release()

            return
        
        request = PLMapperCommand.Request()
        request.pl_mapper_cmd.reset = reset
        request.pl_mapper_cmd.command = PLMapperCommandMsg.PL_MAPPER_CMD_PAUSE
        
        future = self.pl_mapper_command_srv_client.call_async(request)
        future.add_done_callback(self.pl_mapper_command_response_callback)
        
    def pl_mapper_command_response_callback(self, future: rclpy.Future):
        response: PLMapperCommand.Response = future.result()

        if response.pl_mapper_ack != PLMapperCommand.Response.PL_MAPPER_ACK_SUCCESS:
            if self.action_status_lock_.acquire(blocking=True):
                self.action_status = "Failed"
                self.action_status_lock_.release()

        else:
            if self.action_status_lock_.acquire(blocking=True):
                self.action_status = "Success"
                self.action_status_lock_.release()

    def send_update_powerline_overview_command(self, timeout_s):
        if self.action_status_lock_.acquire(blocking=True):
            self.current_action = "UpdatePowerlineOverview"
            self.action_status = "Waiting for reply"
            self.action_status_lock_.release()
            
        if not self.update_powerline_overview_srv_client.wait_for_service(timeout_sec=1.0):
            if self.action_status_lock_.acquire(blocking=True):
                self.action_status = "Cancelled"
                self.action_status_lock_.release()

            return
        
        request = UpdatePowerlineOverview.Request()
        request.timeout_s = timeout_s
        
        future = self.update_powerline_overview_srv_client.call_async(request)
        future.add_done_callback(self.update_powerline_overview_response_callback)
        
    def update_powerline_overview_response_callback(self, future: rclpy.Future):
        response: UpdatePowerlineOverview.Response = future.result()

        if response.success:
            if self.action_status_lock_.acquire(blocking=True):
                self.action_status = "Success"
                self.action_status_lock_.release()
                
        else:
            if self.action_status_lock_.acquire(blocking=True):
                self.action_status = "Failed"
                self.action_status_lock_.release()

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
