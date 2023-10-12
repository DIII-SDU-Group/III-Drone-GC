# III-GC
Graphical user interface for UAV ground control

## Compatibility
This version is compatible with
- `ROS2 Humble`
- [`PX4-Autopilot` DIII fork tag `v1.14.0-rc2`](https://github.com/DIII-SDU-Group/PX4-Autopilot/tree/v1.14.0-rc2)
- [`px4_msgs` DIII fork tag `v1.14`](https://github.com/DIII-SDU-Group/px4_msgs/tree/v1.14)
- [`micro-ROS-agent` DIII fork tag `III-Drone-v2.2`](https://github.com/DIII-SDU-Group/micro-ROS-Agent/tree/III-Drone-v2.2)
- [`micro_ros_msgs` DIII fork tag `III-Drone-v2.2`](https://github.com/DIII-SDU-Group/micro_ros_msgs/tree/III-Drone-v2.2)
- [`III-Drone-Core` v2.2](https://github.com/DIII-SDU-Group/III-Drone-Core/tree/v2.2-staging)
- [`III-Drone-Interfaces` v2.2](https://github.com/DIII-SDU-Group/III-Drone-Interfaces/tree/v2.2-staging)

See [`III-Drone-Core`](https://github.com/DIII-SDU-Group/III-Drone-Core/tree/v2.2-staging) for more information.

## Installation and build
Follow the installation and build guide from [III-Drone-Core](https://github.com/DIII-SDU-Group/III-Drone-Core/tree/v2.2-staging).

## Launching the ground control GUI
After build and installation, the ground control GUI is launched as follows:
```
cd <ROS2-DIII-workspace>
source install/setup.sh
ros2 run iii_drone_gc gui.py --ros-args --params-file ~/.config/iii_drone/params.yaml
```
