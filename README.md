# III-GC
Graphical user interface for UAV ground control

## Compatibility
Compatible with [III-Drone-Core](https://github.com/DIII-SDU-Group/III-Drone-Core/tree/v2.2-staging) and [III-Drone-Interfaces](https://github.com/DIII-SDU-Group/III-Drone-Interfaces/tree/v2.2-staging) v2.2. See [III-Drone-Core](https://github.com/DIII-SDU-Group/III-Drone-Core/tree/v2.2-staging) for more information.

## Installation and build
Follow the installation and build guide from [III-Drone-Core](https://github.com/DIII-SDU-Group/III-Drone-Core/tree/v2.2-staging).

## Launching the ground control GUI
After build and installation, the ground control GUI is launched as follows:
```
cd <ROS2-DIII-workspace>
source install/setup.sh
ros2 run iii_drone_gc gui.py --ros-args --params-file ~/.config/iii_drone/params.yaml
```
