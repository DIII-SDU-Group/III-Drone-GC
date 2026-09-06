import sys
import types
from pathlib import Path
from threading import Lock

from rcl_interfaces.msg import Parameter, ParameterEvent, ParameterType, ParameterValue


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_SRC = PACKAGE_ROOT.parent

for candidate in [
    PACKAGE_ROOT,
    WORKSPACE_SRC / "III-Drone-Core",
    WORKSPACE_SRC / "III-Drone-Configuration",
]:
    if str(candidate) not in sys.path:
        sys.path.insert(0, str(candidate))


interfaces_module = types.ModuleType("iii_drone_interfaces")
interfaces_msg_module = types.ModuleType("iii_drone_interfaces.msg")
interfaces_srv_module = types.ModuleType("iii_drone_interfaces.srv")


class _StubMessage:
    pass


class _StubManeuver:
    MANEUVER_TYPE_NONE = 0
    MANEUVER_TYPE_FLY_TO_POSITION = 1
    MANEUVER_TYPE_FLY_TO_OBJECT = 2
    MANEUVER_TYPE_CABLE_LANDING = 4
    MANEUVER_TYPE_CABLE_TAKEOFF = 5
    MANEUVER_TYPE_HOVER = 6
    MANEUVER_TYPE_HOVER_BY_OBJECT = 7
    MANEUVER_TYPE_HOVER_ON_CABLE = 8


class _StubGripperStatus:
    GRIPPER_STATUS_OPEN = 0


class _StubPLMapperCommandMsg:
    PL_MAPPER_CMD_START = 1
    PL_MAPPER_CMD_STOP = 2
    PL_MAPPER_CMD_FREEZE = 3
    PL_MAPPER_CMD_PAUSE = 4


class _StubService:
    class Request:
        pass

    class Response:
        pass


for name, value in {
    "CombinedDroneAwareness": _StubMessage,
    "Maneuver": _StubManeuver,
    "Target": _StubMessage,
    "StringStamped": _StubMessage,
    "Powerline": _StubMessage,
    "ChargerOperatingMode": _StubMessage,
    "ChargerStatus": _StubMessage,
    "GripperStatus": _StubGripperStatus,
    "PLMapperCommand": _StubPLMapperCommandMsg,
}.items():
    setattr(interfaces_msg_module, name, value)

for name in [
    "GripperCommand",
    "PLMapperCommand",
    "UpdatePowerlineOverview",
    "SelectMissionCatalogEntry",
    "GetParameterYaml",
    "GetDeclaredParameters",
    "SaveParameters",
    "GetParameterFiles",
    "LoadParameters",
    "SetParameterFromGC",
    "GetCurrentParameterFile",
]:
    setattr(interfaces_srv_module, name, _StubService)

interfaces_module.msg = interfaces_msg_module
interfaces_module.srv = interfaces_srv_module
sys.modules.setdefault("iii_drone_interfaces", interfaces_module)
sys.modules.setdefault("iii_drone_interfaces.msg", interfaces_msg_module)
sys.modules.setdefault("iii_drone_interfaces.srv", interfaces_srv_module)

from iii_drone_gc.gc_node import IIIGCNode


class _Message:
    def __init__(self, **kwargs):
        for key, value in kwargs.items():
            setattr(self, key, value)


def _make_node() -> IIIGCNode:
    node = IIIGCNode.__new__(IIIGCNode)
    node.combined_drone_awareness_lock_ = Lock()
    node.current_maneuver_lock_ = Lock()
    node.target_lock_ = Lock()
    node.target_pose_lock_ = Lock()
    node.traj_lock_ = Lock()
    node.reference_mode_lock_ = Lock()
    node.pl_lock_ = Lock()
    node.stored_powerline_status_lock_ = Lock()
    node.pl_mapper_state_lock_ = Lock()
    node.pl_dir_computer_status_lock_ = Lock()
    node.hough_transformer_status_lock_ = Lock()
    node.action_status_lock_ = Lock()
    node.battery_voltage_lock_ = Lock()
    node.charging_power_lock_ = Lock()
    node.charger_operating_mode_lock_ = Lock()
    node.charger_status_lock_ = Lock()
    node.gripper_status_lock_ = Lock()
    node.current_action = "None"
    node.action_status = "Idle"
    node.combined_drone_awareness = None
    node.current_maneuver = None
    node.target = None
    node.target_pose = None
    node.traj = None
    node.reference_mode = None
    node.powerline_tuples_ = []
    node.powerline_quat_ = None
    node.stored_powerline_status_ = None
    node.pl_mapper_state = None
    node.pl_dir_computer_status = None
    node.hough_transformer_status = None
    node.battery_voltage_ = -1
    node.charging_power_ = -1
    node.charger_operating_mode_ = _Message(operating_mode=0)
    node.charger_status_ = _Message(charger_status=0)
    node.gripper_status_ = _Message(gripper_status=_StubGripperStatus.GRIPPER_STATUS_OPEN)
    node._on_set_parameter_callback = None
    return node


class _FakeFuture:
    def __init__(self, result=None):
        self._result = result
        self.callback = None

    def add_done_callback(self, callback):
        self.callback = callback

    def result(self):
        return self._result

    def done(self):
        return True


class _FakeServiceClient:
    def __init__(self, *, available=True, response=None):
        self.available = available
        self.response = response
        self.requests = []
        self.future = _FakeFuture(response)

    def wait_for_service(self, timeout_sec):
        self.timeout_sec = timeout_sec
        return self.available

    def call_async(self, request):
        self.requests.append(request)
        return self.future


def test_combined_drone_awareness_helpers_translate_flags():
    node = _make_node()
    node.on_combined_drone_awareness_msg(
        _Message(
            drone_location=2,
            armed=True,
            offboard=False,
            target_position_known=True,
            has_target=True,
            on_cable_id=7,
            ground_altitude_estimate=3.5,
        )
    )

    assert node.get_drone_location() == "In flight"
    assert node.get_armed() is True
    assert node.get_offboard() is False
    assert node.get_target_position_known() is True
    assert node.get_has_target() is True
    assert node.get_on_cable_id() == 7
    assert node.get_ground_altitude_estimate() == 3.5


def test_current_maneuver_helpers_translate_type_and_status():
    node = _make_node()
    node.on_current_maneuver_msg(
        _Message(
            maneuver_type=4,
            terminated=True,
            success=False,
        )
    )

    assert node.get_current_maneuver_type() == "Cable landing"
    assert node.get_current_maneuver_status() == "Failed"


def test_parameter_event_callback_forwards_changed_parameters():
    node = _make_node()
    captured = []
    node._on_set_parameter_callback = lambda name, value: captured.append((name, value))

    event = ParameterEvent()
    parameter = Parameter(name="foo", value=ParameterValue(type=ParameterType.PARAMETER_STRING, string_value="bar"))
    event.changed_parameters.append(parameter)

    node.on_parameter_event(event)

    assert captured == [("foo", parameter.value)]


def test_status_getters_default_to_unknown_and_update_from_callbacks():
    node = _make_node()

    assert node.get_stored_powerline_status() == "Unknown"
    assert node.get_pl_mapper_state() == "Unknown"
    assert node.get_pl_dir_computer_status() == "Unknown"
    assert node.get_hough_transformer_status() == "Unknown"

    node.on_stored_powerline_status_msg(_Message(data="stored"))
    node.on_pl_mapper_state_msg(_Message(data="mapping"))
    node.on_pl_dir_computer_status_msg(_Message(data="ready"))
    node.on_hough_transformer_status_msg(_Message(data="healthy"))

    assert node.get_stored_powerline_status() == "stored"
    assert node.get_pl_mapper_state() == "mapping"
    assert node.get_pl_dir_computer_status() == "ready"
    assert node.get_hough_transformer_status() == "healthy"


def test_powerline_callback_extracts_ids_points_and_first_orientation():
    node = _make_node()
    node.on_pl_msg(
        _Message(
            lines=[
                _Message(
                    id=7,
                    pose=_Message(
                        position=_Message(x=1.0, y=2.0, z=3.0),
                        orientation=_Message(w=0.9, x=0.1, y=0.2, z=0.3),
                    ),
                ),
                _Message(
                    id=8,
                    pose=_Message(
                        position=_Message(x=4.0, y=5.0, z=6.0),
                        orientation=_Message(w=1.0, x=0.0, y=0.0, z=0.0),
                    ),
                ),
            ]
        )
    )

    assert node.get_cable_ids() == [7, 8]
    assert node.powerline_tuples_ == [(7, [1.0, 2.0, 3.0]), (8, [4.0, 5.0, 6.0])]
    assert node.powerline_quat_ == [0.9, 0.1, 0.2, 0.3]


def test_gripper_command_marks_action_cancelled_when_service_is_unavailable():
    node = _make_node()
    node.gripper_command_srv_client = _FakeServiceClient(available=False)

    node.send_open_gripper_command()

    assert node.get_action_status() == ("OpenGripper", "Cancelled")


def test_gripper_command_sends_request_and_registers_response_callback():
    from iii_drone_gc import gc_node as gc_node_module

    gc_node_module.GripperCommand.Request.GRIPPER_COMMAND_OPEN = 1
    node = _make_node()
    node.gripper_command_srv_client = _FakeServiceClient(available=True)

    node.send_open_gripper_command()

    assert len(node.gripper_command_srv_client.requests) == 1
    assert node.gripper_command_srv_client.requests[0].gripper_command == 1
    assert node.gripper_command_srv_client.future.callback == node.gripper_command_response_callback
    assert node.get_action_status() == ("OpenGripper", "Waiting for reply")


def test_gripper_command_response_callback_updates_action_status():
    from iii_drone_gc import gc_node as gc_node_module

    gc_node_module.GripperCommand.Response.GRIPPER_COMMAND_RESPONSE_SUCCESS = 1
    node = _make_node()

    node.gripper_command_response_callback(
        _FakeFuture(_Message(gripper_command_response=1))
    )
    assert node.get_action_status() == ("None", "Success")

    node.action_status = "Idle"
    node.gripper_command_response_callback(
        _FakeFuture(_Message(gripper_command_response=0))
    )
    assert node.get_action_status() == ("None", "Cancelled")


def test_pl_mapper_command_response_callback_marks_success_and_failure():
    from iii_drone_gc import gc_node as gc_node_module

    gc_node_module.PLMapperCommand.Response.PL_MAPPER_ACK_SUCCESS = 1
    node = _make_node()

    node.pl_mapper_command_response_callback(_FakeFuture(_Message(pl_mapper_ack=1)))
    assert node.get_action_status() == ("None", "Success")

    node.action_status = "Idle"
    node.pl_mapper_command_response_callback(_FakeFuture(_Message(pl_mapper_ack=0)))
    assert node.get_action_status() == ("None", "Failed")
