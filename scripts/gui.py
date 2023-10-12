#!/usr/bin/python3

###############################################################################
# Imports
###############################################################################

###############################################################################
# ROS2:
import rclpy

###############################################################################
# ROS2 interfaces:
from sensor_msgs.msg import Image
from geometry_msgs.msg import PoseStamped
from nav_msgs.msg import Path

###############################################################################
# Custom modules:
from iii_drone_core.utils.math import *
from iii_drone_gc.gc_node import IIIGCNode

###############################################################################
# Custom interfaces:
from iii_drone_interfaces.msg import GripperStatus, ChargerOperatingMode, ChargerStatus

###############################################################################
# Libraries:
import cv2 as cv
import numpy as np
import matplotlib
matplotlib.use('TkAgg')
import matplotlib.pyplot as plt
import tkinter # note that module name has changed from Tkinter in Python 2 to tkinter in Python 3
from tkinter import Toplevel
from PIL import ImageTk, Image

###############################################################################
# Python:
import os
from threading import Thread
from time import sleep
import yaml
import subprocess

###############################################################################
# Class
###############################################################################

normal_button_bg = "#FFFFFF"
normal_button_fg = "#000000"
disabled_button_fg = "#808080"

buttons_font = ("Arial", 20, "bold")
text_font = ("Arial", 20, "bold")

class IIIGui():
    def __init__(self):
        self.node = IIIGCNode()

        self.end = False

        # self.node_thread = Thread(target=self.spin_node)
        # self.node_thread.start()

        sleep(1)

        self.config = yaml.safe_load(open(self.node.config_file_path,"r").read())

        self.config_node_keys = []
        for key in self.config.keys():
            key = str(key)
            if (key == "/**" or key == "tf" or key == "iii_gui"):
                continue

            self.config_node_keys.append(key)

        self.takeoff_height = self.node.get_parameter("takeoff_height_default").get_parameter_value().double_value
        self.target_pose = PoseStamped()
        self.target_cable_id = 0
        self.target_cable_distance = self.node.get_parameter("target_cable_distance_default").get_parameter_value().double_value
        self.flight_distance = 1.
        self.flight_velocity = 1.
        self.invert_flight_direction = False

        self.current_action = "None"
        self.action_status = "Idle"

        # Root:
        self.root = tkinter.Tk()
        self.root.title("III Ground Control")
        screen_width = self.root.winfo_screenwidth()
        screen_height = self.root.winfo_screenheight()
        self.root.geometry(str(screen_width)+"x"+str(screen_height))

        self.vcmd_numeric = (self.root.register(self.validate_numeric_and_empty),
                    '%d', '%i', '%P', '%s', '%S', '%v', '%V', '%W')

        # Diagnostics:
        self.diagnostics_frame = tkinter.Frame(self.root, bg="white")
        self.diagnostics_frame.grid(row=0, column=0)

            # Powerline visualization:
        # Container Frame for PL Visualization and Title
        self.pl_viz_container_frame = tkinter.Frame(self.diagnostics_frame, bg="#007BFF")
        self.pl_viz_container_frame.grid(row=0, column=0, sticky="n")  # Stick to the north to limit size
        self.diagnostics_frame.grid_rowconfigure(1, weight=1)
        self.pl_viz_title = tkinter.Label(self.pl_viz_container_frame, text="Perceived Powerlines", font=("Arial", 16, "bold"), bg="#007BFF", relief="solid", borderwidth=1)
        self.pl_viz_title.grid(row=0, column=0, sticky="new")
        self.pl_viz_frame = tkinter.Frame(self.pl_viz_container_frame, bg="#007BFF", width=400, height=300, bd=2, relief="solid")
        self.pl_viz_frame.grid(row=1, column=0, sticky="nsew", padx=10, pady=10)
        self.label_viz = tkinter.Label(self.pl_viz_frame)
        self.label_viz.grid(row=0, column=0, sticky="nsew")

        self.put_img()

            # Data:
        self.diagnostics_data_frame = tkinter.Frame(self.diagnostics_frame, bg="white")
        self.diagnostics_data_frame.grid(row=1, column=0)

        self.traj_contr_diagnostics_frame = tkinter.Frame(self.diagnostics_data_frame, bg="white")
        self.traj_contr_diagnostics_frame.grid(row=0, column=0, pady=10)

        self.traj_contr_diagnostics_label = tkinter.Label(
            self.traj_contr_diagnostics_frame,
            text="Trajectory controller diagnostics:",
            background="grey",
            font=text_font
        )
        self.traj_contr_diagnostics_label.grid(row=0, column=0, columnspan=2, sticky=tkinter.W+tkinter.E)

        self.control_state_label = tkinter.Label(
            self.traj_contr_diagnostics_frame, 
            text="Trajectory controller state:",
            background="white",
            font=text_font
        )
        self.control_state_label.grid(row=1, column=0)
        self.control_state_value_label = tkinter.Label(
            self.traj_contr_diagnostics_frame,
            text=self.node.get_control_state(),
            background="cyan",
            font=text_font
        )
        self.control_state_value_label.grid(row=1, column=1)

        self.put_control_state()

        self.target_cable_id_label = tkinter.Label(
            self.traj_contr_diagnostics_frame,
            text="Target cable ID:",
            background="white",
            font=text_font
        )
        self.target_cable_id_label.grid(row=2, column=0)

        self.target_cable_id_value_label = tkinter.Label(
            self.traj_contr_diagnostics_frame,
            text=str(self.target_cable_id),
            background="cyan",
            font=text_font
        )
        self.target_cable_id_value_label.grid(row=2, column=1)

        self.put_target_cable_id()

        self.charger_gripper_diagnostics_frame = tkinter.Frame(self.diagnostics_data_frame, bg="white")
        self.charger_gripper_diagnostics_frame.grid(row=1, column=0, pady=10)

        self.charger_gripper_diagnostics_label = tkinter.Label(
            self.charger_gripper_diagnostics_frame,
            text="Charger and gripper diagnostics:",
            background="grey",
            font=text_font
        )
        self.charger_gripper_diagnostics_label.grid(row=0, column=0, columnspan=2, sticky=tkinter.W+tkinter.E)

        self.battery_voltage_label = tkinter.Label(
            self.charger_gripper_diagnostics_frame,
            text="Battery voltage:",
            background="white",
            font=text_font
        )
        self.battery_voltage_label.grid(row=1, column=0)

        self.battery_voltage_value_label = tkinter.Label(
            self.charger_gripper_diagnostics_frame,
            text=str(self.node.get_battery_voltage()),
            background="cyan",
            font=text_font
        )
        self.battery_voltage_value_label.grid(row=1, column=1)

        self.put_battery_voltage()

        self.charging_power_label = tkinter.Label(
            self.charger_gripper_diagnostics_frame,
            text="Charging power:",
            background="white",
            font=text_font
        )
        self.charging_power_label.grid(row=2, column=0)

        self.charging_power_value_label = tkinter.Label(
            self.charger_gripper_diagnostics_frame,
            text=str(self.node.get_charging_power()),
            background="cyan",
            font=text_font
        )
        self.charging_power_value_label.grid(row=2, column=1)

        self.put_charging_power()

        self.charger_operating_mode_label = tkinter.Label(
            self.charger_gripper_diagnostics_frame,
            text="Charger operating mode:",
            background="white",
            font=text_font
        )
        self.charger_operating_mode_label.grid(row=3, column=0)

        self.charger_operating_mode_value_label = tkinter.Label(
            self.charger_gripper_diagnostics_frame,
            text="",
            background="cyan",
            font=text_font
        )
        self.charger_operating_mode_value_label.grid(row=3, column=1)

        self.put_charger_operating_mode()

        self.charger_status_label = tkinter.Label(
            self.charger_gripper_diagnostics_frame,
            text="Charger status:",
            background="white",
            font=text_font
        )
        self.charger_status_label.grid(row=4, column=0)

        self.charger_status_value_label = tkinter.Label(
            self.charger_gripper_diagnostics_frame,
            text="",
            background="cyan",
            font=text_font
        )
        self.charger_status_value_label.grid(row=4, column=1)

        self.put_charger_status()


        self.gripper_status_label = tkinter.Label(
            self.charger_gripper_diagnostics_frame,
            text="Gripper status:",
            background="white",
            font=text_font
        )
        self.gripper_status_label.grid(row=5, column=0)

        gripper_status = "open" if self.node.get_gripper_status().gripper_status == GripperStatus.GRIPPER_STATUS_OPEN else "closed"

        self.gripper_status_value_label = tkinter.Label(
            self.charger_gripper_diagnostics_frame,
            text=gripper_status,
            background="cyan",
            font=text_font
        )
        self.gripper_status_value_label.grid(row=5, column=1)

        self.put_gripper_status()

        # Mission diagnostics:
        self.mission_diagnostics_frame = tkinter.Frame(self.diagnostics_data_frame, bg="white")
        self.mission_diagnostics_frame.grid(row=2, column=0, pady=10)

        self.mission_diagnostics_label = tkinter.Label(
            self.mission_diagnostics_frame,
            text="Mission diagnostics:",
            background="grey",
            font=text_font
        )

        self.mission_diagnostics_label.grid(row=0, column=0, columnspan=2, sticky=tkinter.W+tkinter.E)

        self.cont_mission_orch_state_label = tkinter.Label(
            self.mission_diagnostics_frame,
            text="Continuous mission orchestrator state:",
            background="white",
            font=text_font
        )

        self.cont_mission_orch_state_label.grid(row=1, column=0)

        self.cont_mission_orch_state_value_label = tkinter.Label(
            self.mission_diagnostics_frame,
            text=self.node.get_cont_mission_orch_state(),
            background="cyan",
            font=text_font
        )

        self.cont_mission_orch_state_value_label.grid(row=1, column=1)

        self.put_cont_mission_orch_state()

        # Action control:
        self.action_control_frame = tkinter.Frame(self.root, bg="#000000")
        self.action_control_frame.grid(row=0, column=1)

        self.cancel_action_frame = tkinter.Frame(self.action_control_frame, bg="yellow")
        self.cancel_action_frame.grid(row=0, column=0)

        self.cancel_action_button = tkinter.Button(
            self.cancel_action_frame,
            text="Cancel action",
            command=self.cancel_action,
            bg="red",
            fg="black",
            font=buttons_font,
        )
        self.cancel_action_button.grid(row=0, column=0, pady=10)

        self.set_cancel_button_state()

        self.action_diagnostics_frame = tkinter.Frame(self.action_control_frame, bg="#000000")
        self.action_diagnostics_frame.grid(row=0, column=1)

        self.current_action_label = tkinter.Label(
            self.action_diagnostics_frame, 
            text="Current action:",
            bg="white",
            font=text_font
        )
        self.current_action_label.grid(row=0, column=0)

        self.current_action_value_label = tkinter.Label(
            self.action_diagnostics_frame,
            text=self.current_action,
            bg="cyan",
            font=text_font
        )
        self.current_action_value_label.grid(row=0, column=1)

        self.action_status_label = tkinter.Label(
            self.action_diagnostics_frame, 
            text="Action status:",
            bg="white",
            font=text_font
        )
        self.action_status_label.grid(row=1, column=0)

        self.action_status_value_label = tkinter.Label(
            self.action_diagnostics_frame,
            text=self.action_status,
            bg="cyan",
            font=text_font
        )
        self.action_status_value_label.grid(row=1, column=1)

        self.put_action_status()


        # Select action view
        self.action_view_select_frame = tkinter.Frame(self.action_control_frame)
        self.action_view_select_frame.grid(row=1, column=0, columnspan=2, pady=10)

        self.action_view_select_label = tkinter.Label(
            self.action_view_select_frame,
            text="Action view selection:",
            bg="grey",
            font=text_font
        )
        self.action_view_select_label.grid(row=0, column=0)

        self.action_view_select_buttons_frame = tkinter.Frame(self.action_view_select_frame)
        self.action_view_select_buttons_frame.grid(row=1, column=0)

        self.action_view_gripper_control_button = tkinter.Button(
            self.action_view_select_buttons_frame,
            text="Gripper ctrl",
            command=self.on_gripper_action_view_select,
            bg=normal_button_bg,
            fg=normal_button_fg,
            font=buttons_font,
        )
        self.action_view_gripper_control_button.grid(row=0, column=0)

        self.action_view_low_level_button = tkinter.Button(
            self.action_view_select_buttons_frame,
            text="Low level ctrl",
            command=self.on_low_level_action_view_select,
            bg=normal_button_bg,
            fg=normal_button_fg,
            font=buttons_font,
        )
        self.action_view_low_level_button.grid(row=0, column=1)

        self.action_view_high_level_button = tkinter.Button(
            self.action_view_select_buttons_frame,
            text="High level ctrl",
            command=self.on_high_level_action_view_select,
            bg=normal_button_bg,
            fg=normal_button_fg,
            font=buttons_font,
        )
        self.action_view_high_level_button.grid(row=0, column=2)

        self.current_action_view = "low level"

        # Low level action view
        self.low_level_action_view_frame = tkinter.Frame(self.action_control_frame, bg="#000000")

        # Takeoff:
        self.takeoff_button = tkinter.Button(
            self.low_level_action_view_frame,
            text="Takeoff",
            command=self.execute_takeoff,
            bg=normal_button_bg,
            fg=normal_button_fg,
            disabledforeground=disabled_button_fg,
            font=buttons_font,
        )
        self.takeoff_button.grid(row=1, column=0, pady=10)

        self.takeoff_parameters_frame = tkinter.Frame(self.low_level_action_view_frame, bg="#000000")
        self.takeoff_parameters_frame.grid(row=1, column=1)

        self.takeoff_height_label = tkinter.Label(
            self.takeoff_parameters_frame,
            text="Height: ",
            font=text_font
        )
        self.takeoff_height_label.grid(row=0, column=0)

        self.takeoff_height_entry = tkinter.Entry(
            self.takeoff_parameters_frame,
            validate="key",
            validatecommand=self.vcmd_numeric,
            font=text_font
        )
        self.takeoff_height_entry.insert(0, str(self.takeoff_height))
        self.takeoff_height_entry.grid(row=0, column=1)

        # Landing:
        self.land_button = tkinter.Button(
            self.low_level_action_view_frame,
            text="Land",
            command=self.execute_landing,
            bg=normal_button_bg,
            fg=normal_button_fg,
            disabledforeground=disabled_button_fg,
            font=buttons_font,
        )
        self.land_button.grid(row=2, column=0, pady=10)

        # Fly to position:
        self.fly_to_position_button = tkinter.Button(
            self.low_level_action_view_frame,
            text="Fly to position",
            command=self.execute_fly_to_position,
            bg=normal_button_bg,
            fg=normal_button_fg,
            disabledforeground=disabled_button_fg,
            font=buttons_font,
        )
        self.fly_to_position_button.grid(row=3, column=0, pady=10)

        self.fly_to_position_parameters_frame = tkinter.Frame(self.low_level_action_view_frame, bg="#000000")
        self.fly_to_position_parameters_frame.grid(row=3, column=1, pady=10)

        self.fly_to_position_x_label = tkinter.Label(
            self.fly_to_position_parameters_frame,
            text="X: ",
            font=text_font
        )
        self.fly_to_position_x_label.grid(row=0, column=0)

        self.fly_to_position_x_entry = tkinter.Entry(
            self.fly_to_position_parameters_frame,
            validate="key",
            validatecommand=self.vcmd_numeric,
            font=text_font
        )
        self.fly_to_position_x_entry.insert(0, str(1))
        self.fly_to_position_x_entry.grid(row=0, column=1)

        self.fly_to_position_y_label = tkinter.Label(
            self.fly_to_position_parameters_frame,
            text="Y: ",
            font=text_font
        )
        self.fly_to_position_y_label.grid(row=1, column=0)

        self.fly_to_position_y_entry = tkinter.Entry(
            self.fly_to_position_parameters_frame,
            validate="key",
            validatecommand=self.vcmd_numeric,
            font=text_font
        )
        self.fly_to_position_y_entry.insert(0, str(0))
        self.fly_to_position_y_entry.grid(row=1, column=1)

        self.fly_to_position_z_label = tkinter.Label(
            self.fly_to_position_parameters_frame,
            text="Z: ",
            font=text_font
        )
        self.fly_to_position_z_label.grid(row=2, column=0)

        self.fly_to_position_z_entry = tkinter.Entry(
            self.fly_to_position_parameters_frame,
            validate="key",
            validatecommand=self.vcmd_numeric,
            font=text_font
        )
        self.fly_to_position_z_entry.insert(0, str(0))
        self.fly_to_position_z_entry.grid(row=2, column=1)

        self.fly_to_position_yaw_label = tkinter.Label(
            self.fly_to_position_parameters_frame,
            text="Yaw: ",
            font=text_font
        )
        self.fly_to_position_yaw_label.grid(row=3, column=0)

        self.fly_to_position_yaw_entry = tkinter.Entry(
            self.fly_to_position_parameters_frame,
            validate="key",
            validatecommand=self.vcmd_numeric,
            font=text_font
        )
        self.fly_to_position_yaw_entry.insert(0, str(0))
        self.fly_to_position_yaw_entry.grid(row=3, column=1)

        # Fly under cable:
        self.fly_under_cable_button = tkinter.Button(
            self.low_level_action_view_frame,
            text="Fly under cable",
            command=self.execute_fly_under_cable,
            bg=normal_button_bg,
            fg=normal_button_fg,
            disabledforeground=disabled_button_fg,
            font=buttons_font,
        )
        self.fly_under_cable_button.grid(row=4, column=0, pady=10)

        self.fly_under_cable_parameters_frame = tkinter.Frame(self.low_level_action_view_frame, bg="#000000")
        self.fly_under_cable_parameters_frame.grid(row=4, column=1, pady=10)

        self.fly_under_cable_target_cable_id_label = tkinter.Label(
            self.fly_under_cable_parameters_frame,
            text="Fly under cable target cable ID: ",
            font=text_font
        )
        self.fly_under_cable_target_cable_id_label.grid(row=0, column=0)

        self.cable_ids = self.node.get_cable_ids()
        self.fly_under_cable_target_cable_id_stringvar = tkinter.StringVar(self.low_level_action_view_frame)
        self.fly_under_cable_target_cable_id_stringvar.set(self.cable_ids[0] if len(self.cable_ids) > 0 else "")
        self.fly_under_cable_target_cable_id_optionmenu = tkinter.OptionMenu(
            self.fly_under_cable_parameters_frame,
            self.fly_under_cable_target_cable_id_stringvar,
            tuple(*self.cable_ids) if len(self.cable_ids) > 0 else (""),
        )
        self.fly_under_cable_target_cable_id_optionmenu.config(font=text_font)
        self.fly_under_cable_target_cable_id_optionmenu_menu = self.root.nametowidget(self.fly_under_cable_target_cable_id_optionmenu.menuname)
        self.fly_under_cable_target_cable_id_optionmenu_menu.config(font=text_font)
        self.update_target_cable_id_optionmenu()
        self.fly_under_cable_target_cable_id_optionmenu.grid(row=0, column=1)

        self.fly_under_cable_target_cable_distance_label = tkinter.Label(
            self.fly_under_cable_parameters_frame,
            text="Fly under cable target cable distance: ",
            font=text_font
        )
        self.fly_under_cable_target_cable_distance_label.grid(row=1, column=0)

        self.fly_under_cable_target_cable_distance_entry = tkinter.Entry(
            self.fly_under_cable_parameters_frame,
            validate="key",
            validatecommand=self.vcmd_numeric,
            font=text_font
        )
        self.fly_under_cable_target_cable_distance_entry.insert(0, str(self.target_cable_distance))
        self.fly_under_cable_target_cable_distance_entry.grid(row=1, column=1)

        # Cable landing:
        self.cable_landing_button = tkinter.Button(
            self.low_level_action_view_frame,
            text="Land on cable",
            command=self.execute_cable_landing,
            bg=normal_button_bg,
            fg=normal_button_fg,
            disabledforeground=disabled_button_fg,
            font=buttons_font,
        )

        self.cable_landing_button.grid(row=5, column=0, pady=10)

        # Disarm on cable:
        self.disarm_on_cable_button = tkinter.Button(
            self.low_level_action_view_frame,
            text="Disarm on cable",
            command=self.execute_disarm_on_cable,
            bg=normal_button_bg,
            fg=normal_button_fg,
            disabledforeground=disabled_button_fg,
            font=buttons_font,
        )

        self.disarm_on_cable_button.grid(row=6, column=0, pady=10)

        # Arm on cable:
        self.arm_on_cable_button = tkinter.Button(
            self.low_level_action_view_frame,
            text="Arm on cable",
            command=self.execute_arm_on_cable,
            bg=normal_button_bg,
            fg=normal_button_fg,
            disabledforeground=disabled_button_fg,
            font=buttons_font,
        )

        self.arm_on_cable_button.grid(row=7, column=0, pady=10)

        # Cable takeoff:
        self.cable_takeoff_button = tkinter.Button(
            self.low_level_action_view_frame,
            text="Takeoff from cable",
            command=self.execute_cable_takeoff,
            bg=normal_button_bg,
            fg=normal_button_fg,
            disabledforeground=disabled_button_fg,
            font=buttons_font,
        )
        self.cable_takeoff_button.grid(row=8, column=0, pady=10)

        self.cable_takeoff_parameters_frame = tkinter.Frame(self.low_level_action_view_frame, bg="#000000")
        self.cable_takeoff_parameters_frame.grid(row=8, column=1, pady=10)

        self.cable_takeoff_target_cable_distance_label = tkinter.Label(
            self.cable_takeoff_parameters_frame,
            text="Cable takeoff target cable distance: ",
            font=text_font
        )
        self.cable_takeoff_target_cable_distance_label.grid(row=0, column=0)

        self.cable_takeoff_target_cable_distance_entry = tkinter.Entry(
            self.cable_takeoff_parameters_frame,
            validate="key",
            validatecommand=self.vcmd_numeric,
            font=text_font
        )
        self.cable_takeoff_target_cable_distance_entry.insert(0, str(self.target_cable_distance))
        self.cable_takeoff_target_cable_distance_entry.grid(row=0, column=1)

        # Gripper control action view
        self.gripper_ctrl_action_view_frame = tkinter.Frame(self.action_control_frame, bg="#000000")

        # Open gripper:
        self.gripper_frame = tkinter.Frame(self.gripper_ctrl_action_view_frame, bg="white")
        self.gripper_frame.grid(row=0, column=0, pady=10)

        self.open_gripper_button = tkinter.Button(
            self.gripper_frame,
            text="Open gripper",
            command=self.execute_open_gripper,
            bg=normal_button_bg,
            fg=normal_button_fg,
            disabledforeground=disabled_button_fg,
            font=buttons_font,
        )
        self.open_gripper_button.grid(row=0, column=0, pady=10)

        # Close gripper:
        self.close_gripper_button = tkinter.Button(
            self.gripper_frame,
            text="Close gripper",
            command=self.execute_close_gripper,
            bg=normal_button_bg,
            fg=normal_button_fg,
            disabledforeground=disabled_button_fg,
            font=buttons_font,
        )
        self.close_gripper_button.grid(row=1, column=0, pady=10)

        # High level action view
        self.high_level_action_view_frame = tkinter.Frame(self.action_control_frame, bg="#000000")

        # Set target cable id:
        self.set_target_cable_id_button = tkinter.Button(
            self.high_level_action_view_frame,
            text="Set target cable ID",
            command=self.execute_set_target_cable_id,
            bg=normal_button_bg,
            fg=normal_button_fg,
            font=buttons_font,
        )

        self.set_target_cable_id_button.grid(row=0, column=0, pady=10)

        self.set_target_cable_id_parameters_frame = tkinter.Frame(self.high_level_action_view_frame, bg="#000000")
        self.set_target_cable_id_parameters_frame.grid(row=0, column=1)

        self.set_target_cable_id_label = tkinter.Label(
            self.set_target_cable_id_parameters_frame,
            text="Target cable id: ",
            font=text_font
        )
        self.set_target_cable_id_label.grid(row=0, column=0)

        self.set_target_cable_id_stringvar = tkinter.StringVar(self.high_level_action_view_frame)
        self.set_target_cable_id_stringvar.set(self.cable_ids[0] if len(self.cable_ids) > 0 else "")
        self.set_target_cable_id_optionmenu = tkinter.OptionMenu(
            self.set_target_cable_id_parameters_frame,
            self.set_target_cable_id_stringvar,
            tuple(*self.cable_ids) if len(self.cable_ids) > 0 else (""),
        )
        self.set_target_cable_id_optionmenu.config(font=text_font)
        self.set_target_cable_id_optionmenu_menu = self.root.nametowidget(self.set_target_cable_id_optionmenu.menuname)
        self.set_target_cable_id_optionmenu_menu.config(font=text_font)
        self.update_set_target_cable_id_optionmenu()
        self.set_target_cable_id_optionmenu.grid(row=0, column=1)

        # Initiate charging:
        self.initiate_charging_button = tkinter.Button(
            self.high_level_action_view_frame,
            text="Initiate charging",
            command=self.execute_initiate_charging,
            bg=normal_button_bg,
            fg=normal_button_fg,
            disabledforeground=disabled_button_fg,
            font=buttons_font,
        )
    
        self.initiate_charging_button.grid(row=1, column=0, pady=10)

        # Interrupt charging:
        self.interrupt_charging_button = tkinter.Button(
            self.high_level_action_view_frame,
            text="Interrupt charging",
            command=self.execute_interrupt_charging,
            bg=normal_button_bg,
            fg=normal_button_fg,
            disabledforeground=disabled_button_fg,
            font=buttons_font,
        )

        self.interrupt_charging_button.grid(row=2, column=0, pady=10)

        # Prolong charging:
        self.prolong_charging_button = tkinter.Button(
            self.high_level_action_view_frame,
            text="Prolong charging",
            command=self.execute_prolong_charging,
            bg=normal_button_bg,
            fg=normal_button_fg,
            font=buttons_font,
        )

        self.prolong_charging_button.grid(row=3, column=0, pady=10)

        self.prolong_charging_parameters_frame = tkinter.Frame(self.high_level_action_view_frame, bg="#000000")
        self.prolong_charging_parameters_frame.grid(row=3, column=1)

        self.prolong_charging_mode_label = tkinter.Label(
            self.prolong_charging_parameters_frame,
            text="Prolong charging mode: ",
            font=text_font
        )
        self.prolong_charging_mode_label.grid(row=0, column=0)

        self.prolong_charging_modes = ["Until interrupted", "Clear"]
        self.prolong_charging_mode_stringvar = tkinter.StringVar(self.high_level_action_view_frame)
        self.prolong_charging_mode_stringvar.set(self.prolong_charging_modes[0])
        self.prolong_charging_mode_optionmenu = tkinter.OptionMenu(
            self.prolong_charging_parameters_frame,
            self.prolong_charging_mode_stringvar,
            *self.prolong_charging_modes,
        )
        self.prolong_charging_mode_optionmenu.config(font=text_font)
        self.prolong_charging_mode_optionmenu_menu = self.root.nametowidget(self.prolong_charging_mode_optionmenu.menuname)
        self.prolong_charging_mode_optionmenu_menu.config(font=text_font)
        self.prolong_charging_mode_optionmenu.grid(row=0, column=1)

        # Put action view:
        self.on_low_level_action_view_select()

        # Update actions:
        self.update_available_actions()

    def update_available_actions(self):
        control_state = self.node.get_control_state()

        gripper_status: GripperStatus = self.node.get_gripper_status()

        # Takeoff:
        if control_state == "on ground non offboard":
            self.takeoff_button.config(state="normal")
            self.takeoff_height_entry.config(state="normal")

        else:
            self.takeoff_button.config(state="disabled")
            self.takeoff_height_entry.config(state="disabled")

        if self.action_status == "Executing":
            self.cancel_action_button.config(state="disabled")

        # Landing:
        if control_state == "hovering" or control_state == "hovering under cable":
            self.land_button.config(state="normal")

        else:
            self.land_button.config(state="disabled")

        if self.action_status == "Executing":
            self.cancel_action_button.config(state="disabled")

        # FlyToPosition:
        if control_state == "hovering" or control_state == "hovering under cable":
            self.fly_to_position_button.config(state="normal")
            self.fly_to_position_x_entry.config(state="normal")
            self.fly_to_position_y_entry.config(state="normal")
            self.fly_to_position_z_entry.config(state="normal")
            self.fly_to_position_yaw_entry.config(state="normal")

        else:
            self.fly_to_position_button.config(state="disabled")
            self.fly_to_position_x_entry.config(state="disabled")
            self.fly_to_position_y_entry.config(state="disabled")
            self.fly_to_position_z_entry.config(state="disabled")
            self.fly_to_position_yaw_entry.config(state="disabled")

        if self.action_status == "Executing":
            self.fly_to_position_button.config(state="disabled")
            self.fly_to_position_x_entry.config(state="disabled")
            self.fly_to_position_y_entry.config(state="disabled")
            self.fly_to_position_z_entry.config(state="disabled")
            self.fly_to_position_yaw_entry.config(state="disabled")

        # FlyUnderCable:
        if (control_state == "hovering" or control_state == "hovering under cable") and len(self.cable_ids) > 0:
            self.fly_under_cable_button.config(state="normal")
            self.fly_under_cable_target_cable_id_optionmenu.config(state="normal")
            self.fly_under_cable_target_cable_distance_entry.config(state="normal")

        else:
            self.fly_under_cable_button.config(state="disabled")
            self.fly_under_cable_target_cable_id_optionmenu.config(state="disabled")
            self.fly_under_cable_target_cable_distance_entry.config(state="disabled")

        if self.action_status == "Executing":
            self.fly_under_cable_button.config(state="disabled")
            self.fly_under_cable_target_cable_id_optionmenu.config(state="disabled")
            self.fly_under_cable_target_cable_distance_entry.config(state="disabled")

        # CableLanding:
        if control_state == "hovering under cable":
            self.cable_landing_button.config(state="normal")

        else:
            self.cable_landing_button.config(state="disabled")

        if self.action_status == "Executing":
            self.cable_landing_button.config(state="disabled")

        # DisarmOnCable:
        if control_state == "on cable armed":
            self.disarm_on_cable_button.config(state="normal")

        else:
            self.disarm_on_cable_button.config(state="disabled")

        if self.action_status == "Executing":
            self.disarm_on_cable_button.config(state="disabled")

        # ArmOnCable:
        if control_state == "on cable disarmed":
            self.arm_on_cable_button.config(state="normal")

        else:
            self.arm_on_cable_button.config(state="disabled")

        if self.action_status == "Executing":
            self.arm_on_cable_button.config(state="disabled")

        # CableTakeoff:
        if control_state == "on cable armed":
            self.cable_takeoff_button.config(state="normal")
            self.cable_takeoff_target_cable_distance_entry.config(state="normal")

            self.cable_takeoff_target_cable_distance_entry.delete(0, "end")
            self.cable_takeoff_target_cable_distance_entry.insert(0, str(self.target_cable_distance))

        else:
            self.cable_takeoff_button.config(state="disabled")
            self.cable_takeoff_target_cable_distance_entry.config(state="disabled")

        if self.action_status == "Executing":
            self.cable_takeoff_button.config(state="disabled")
            self.cable_takeoff_target_cable_distance_entry.config(state="disabled")

        # OpenGripper:
        if self.current_action == "OpenGripper" and self.action_status == "Executing":
            self.open_gripper_button.config(state="disabled")

        elif gripper_status.gripper_status != GripperStatus.GRIPPER_STATUS_CLOSED:
            self.open_gripper_button.config(state="disabled")
        
        elif control_state == "on cable disarmed":
            self.open_gripper_button.config(state="disabled")

        else:
            self.open_gripper_button.config(state="normal")

        if self.action_status == "Executing":
            self.open_gripper_button.config(state="disabled")

        # CloseGripper:
        if self.current_action == "CloseGripper" and self.action_status == "Executing":
            self.close_gripper_button.config(state="disabled")

        elif gripper_status.gripper_status != GripperStatus.GRIPPER_STATUS_OPEN:
            self.close_gripper_button.config(state="disabled")

        else:
            self.close_gripper_button.config(state="normal")

        if self.action_status == "Executing":
            self.close_gripper_button.config(state="disabled")

        # Mission actions:
        cont_mission_orch_state = self.node.get_cont_mission_orch_state()

        # SetTargetCableId:
        if cont_mission_orch_state == "unknown" or self.action_status == "Executing":
            self.set_target_cable_id_button.config(state="disabled")
        else:
            self.set_target_cable_id_button.config(state="normal")

        # InitiateCharging:
        if cont_mission_orch_state != "inspecting" or self.action_status == "Executing":
            self.initiate_charging_button.config(state="disabled")
        else:
            self.initiate_charging_button.config(state="normal")

        # InterruptCharging:
        if cont_mission_orch_state != "charging" or self.action_status == "Executing":
            self.interrupt_charging_button.config(state="disabled")

        else:
            self.interrupt_charging_button.config(state="normal")

        # ProlongCharging:
        if cont_mission_orch_state != "charging" or self.action_status == "Executing":
            self.prolong_charging_button.config(state="disabled")
            self.prolong_charging_mode_optionmenu.config(state="disabled")
        
        else:
            self.prolong_charging_button.config(state="normal")
            self.prolong_charging_mode_optionmenu.config(state="normal")

        if not self.end:
            self.root.after(100, self.update_available_actions)

    def on_gripper_action_view_select(self):
        self.low_level_action_view_frame.grid_forget()
        self.high_level_action_view_frame.grid_forget()
        self.gripper_ctrl_action_view_frame.grid(row=2, column=0, columnspan=2, pady=10)

    def on_low_level_action_view_select(self):
        self.high_level_action_view_frame.grid_forget()
        self.gripper_ctrl_action_view_frame.grid_forget()
        self.low_level_action_view_frame.grid(row=2, column=0, columnspan=2, sticky=tkinter.W+tkinter.E, pady=10)

    def on_high_level_action_view_select(self):
        self.low_level_action_view_frame.grid_forget()
        self.gripper_ctrl_action_view_frame.grid_forget()
        self.high_level_action_view_frame.grid(row=2, column=0, columnspan=2, sticky=tkinter.W+tkinter.E, pady=10)

    def execute_takeoff(self):
        try:
            self.takeoff_height = float(self.takeoff_height_entry.get())
            self.takeoff_height_entry.configure(
                bg="white"
            )
            print("Taking off to height: "+str(self.takeoff_height))
            self.takeoff_height_entry.delete(0, tkinter.END)
            self.takeoff_height_entry.insert(0, str(self.node.get_parameter("takeoff_height_default").get_parameter_value().double_value))
            self.node.send_takeoff_action_request(self.takeoff_height)
        except ValueError:
            self.takeoff_height_entry.configure(
                bg="red"
            )

            return

    def execute_landing(self):
        print("Landing")
        self.node.send_landing_action_request()

    def execute_fly_to_position(self):
        x = 0
        y = 0
        z = 0
        yaw = 0

        fail = False

        try:
            x = float(self.fly_to_position_x_entry.get())
            self.fly_to_position_x_entry.configure(
                bg="white"
            )
        except ValueError:
            self.fly_to_position_x_entry.configure(
                bg="red"
            )
            fail = True
            
        try:
            y = float(self.fly_to_position_y_entry.get())
            self.fly_to_position_y_entry.configure(
                bg="white"
            )
        except ValueError:
            self.fly_to_position_y_entry.configure(
                bg="red"
            )
            fail = True

        try:
            z = float(self.fly_to_position_z_entry.get())
            self.fly_to_position_z_entry.configure(
                bg="white"
            )
        except ValueError:
            self.fly_to_position_z_entry.configure(
                bg="red"
            )
            fail = True

        try:
            yaw = float(self.fly_to_position_yaw_entry.get())
            self.fly_to_position_yaw_entry.configure(
                bg="white"
            )
        except ValueError:
            self.fly_to_position_yaw_entry.configure(
                bg="red"
            )
            fail = True

        if fail:
            return

        self.target_pose = PoseStamped()
        self.target_pose.header.stamp = self.node.get_clock().now().to_msg()
        self.target_pose.header.frame_id = "drone"
        self.target_pose.pose.position.x = x
        self.target_pose.pose.position.y = y
        self.target_pose.pose.position.z = z

        quaternion = eulToQuat([0,0,yaw])

        self.target_pose.pose.orientation.w = quaternion[0]
        self.target_pose.pose.orientation.x = quaternion[1]
        self.target_pose.pose.orientation.y = quaternion[2]
        self.target_pose.pose.orientation.z = quaternion[3]

        self.node.send_fly_to_position_action_request(self.target_pose)

    def execute_fly_under_cable(self):
        fail = False

        try:
            self.target_cable_id = int(self.fly_under_cable_target_cable_id_stringvar.get())
            self.fly_under_cable_target_cable_id_optionmenu.configure(
                bg="white"
            )
        except ValueError:
            self.fly_under_cable_target_cable_id_optionmenu.configure(
                bg="red"
            )
            fail = True

        try:
            self.target_cable_distance = float(self.fly_under_cable_target_cable_distance_entry.get())
            self.fly_under_cable_target_cable_distance_entry.configure(
                bg="white"
            )
        except ValueError:
            self.fly_under_cable_target_cable_distance_entry.configure(
                bg="red"
            )
            fail = True

        if fail:
            return
        
        self.node.send_fly_under_cable_action_request(self.target_cable_id, self.target_cable_distance)

    def execute_cable_landing(self):
        cable_id = self.node.get_target_cable_id()
        self.node.send_cable_landing_action_request(cable_id if cable_id is not None else self.target_cable_id)

    def execute_disarm_on_cable(self):
        self.node.send_disarm_on_cable_action_request()

    def execute_arm_on_cable(self):
        self.node.send_arm_on_cable_action_request()

    def execute_cable_takeoff(self):
        try:
            self.target_cable_distance = float(self.cable_takeoff_target_cable_distance_entry.get())
            self.cable_takeoff_target_cable_distance_entry.configure(
                bg="white"
            )
        except ValueError:
            self.cable_takeoff_target_cable_distance_entry.configure(
                bg="red"
            )

            return

        self.node.send_cable_takeoff_action_request(self.target_cable_distance)

    def execute_open_gripper(self):
        self.node.send_open_gripper_command()

    def execute_close_gripper(self):
        self.node.send_close_gripper_command()

    def execute_set_target_cable_id(self):
        try:
            self.target_cable_id = int(self.set_target_cable_id_stringvar.get())
            self.set_target_cable_id_optionmenu.configure(
                bg="white"
            )
        except ValueError:
            self.set_target_cable_id_optionmenu.configure(
                bg="red"
            )

            return

        self.node.set_target_cable_id(self.target_cable_id)

    def execute_initiate_charging(self):
        self.node.initiate_charging()

    def execute_interrupt_charging(self):
        self.node.interrupt_charging()

    def execute_prolong_charging(self):
        mode = self.prolong_charging_mode_stringvar.get()

        if mode == "Until interrupted":
            self.node.prolong_charging_until_interrupted()
        elif mode == "Clear":
            self.node.prolong_charging_clear()

    def update_target_cable_id_optionmenu(self):
        old_cable_ids = self.cable_ids
        self.cable_ids = self.node.get_cable_ids()
        if len(old_cable_ids) == 0 or int(self.fly_under_cable_target_cable_id_stringvar.get()) not in self.cable_ids:
            self.fly_under_cable_target_cable_id_stringvar.set(self.cable_ids[0] if len(self.cable_ids) > 0 else "")
        self.fly_under_cable_target_cable_id_optionmenu["menu"].delete(0, "end")
        for cable_id in self.cable_ids:
            self.fly_under_cable_target_cable_id_optionmenu["menu"].add_command(label=cable_id, command=lambda value=cable_id: self.fly_under_cable_target_cable_id_stringvar.set(value))

        if not self.end:
            self.root.after(1000, self.update_target_cable_id_optionmenu)

    def update_set_target_cable_id_optionmenu(self):
        old_cable_ids = self.cable_ids
        self.cable_ids = self.node.get_cable_ids()
        str_var = self.set_target_cable_id_stringvar.get()
        if len(old_cable_ids) == 0 or str_var == "" or int(str_var) not in self.cable_ids:
            self.set_target_cable_id_stringvar.set(self.cable_ids[0] if len(self.cable_ids) > 0 else "")
        self.set_target_cable_id_optionmenu["menu"].delete(0, "end")
        for cable_id in self.cable_ids:
            self.set_target_cable_id_optionmenu["menu"].add_command(label=cable_id, command=lambda value=cable_id: self.set_target_cable_id_stringvar.set(value))

        if not self.end:
            self.root.after(1000, self.update_set_target_cable_id_optionmenu)

    def main_loop(self):
        try:
            while True:
                rclpy.spin_once(self.node, timeout_sec=0.1)
                self.root.update_idletasks()
                self.root.update()

        except KeyboardInterrupt:
            self.end = True
            self.node.destroy_node()

    def set_params(self):
        self.params_options_window = Toplevel(self.root)
        self.params_options_window.title("Params options")
        self.params_options_frame = tkinter.Frame(self.params_options_window, bg="white")

        self.params_options_frame.grid()

        node_key = self.param_stringvar.get()

        params = []
        for key in self.config[node_key][node_key]["ros__parameters"].keys():
            params.append(str(key))

        param_stringvar = tkinter.StringVar(self.root)
        param_stringvar.set(params[0])
        param_optionmenu = tkinter.OptionMenu(
            self.params_options_frame,
            param_stringvar,
            *params
        )

        param_optionmenu.grid()

        value_label = tkinter.Label(
            self.params_options_frame,
            text="Parameter value:",
            font=text_font
        )
        value_entry = tkinter.Entry(
            self.params_options_frame
        )

        value_label.grid()
        value_entry.grid()

        def on_cancel_btn_click():
            self.params_options_window.destroy()
            self.params_options_window = None
            self.params_options_frame = None

        def on_ok_btn_click():
            value = value_entry.get()
            param = param_stringvar.get()

            parameter_type = type(self.config[node_key][node_key]["ros__parameters"][param])

            success = True

            try:
                value = parameter_type(value)
            except ValueError:
                success = False

            if success:
                node_name = "/" + node_key + "/" + node_key

                bashCommand = str("ros2 param set " + str(node_name) + " " + str(param) + " " + str(value))
                process = subprocess.Popen(bashCommand.split(), stdout=subprocess.PIPE)
                output, error = process.communicate()

                self.node.get_logger().info(str(output))
                self.node.get_logger().info(str(error))

            self.params_options_window.destroy()
            self.params_options_window = None
            self.params_options_frame = None

        ok_btn = tkinter.Button(
            self.params_options_frame,
            text="OK",
            command=on_ok_btn_click,
            font=buttons_font,
        )

        cancel_btn = tkinter.Button(
            self.params_options_frame,
            text="Cancel",
            command=on_cancel_btn_click,
            font=buttons_font,
        )

        ok_btn.grid()
        cancel_btn.grid()

    def execute_action(self):
        self.action_options_window = Toplevel(self.root)
        self.action_options_window.title("Action options")
        self.action_options_frame = tkinter.Frame(self.action_options_window, bg="white")

        self.action_options_frame.grid()

        action = self.action_stringvar.get()

        vcmd_numeric = (self.root.register(self.validate_numeric_and_empty),
                    '%d', '%i', '%P', '%s', '%S', '%v', '%V', '%W')

        def on_cancel_btn_click():
            self.action_options_window.destroy()
            self.action_options_window = None
            self.action_options_frame = None


        if (action == "Takeoff"):
            takeoff_label = tkinter.Label(
                self.action_options_frame,
                text="Takeoff options",
            font=text_font
            )
            takeoff_height_label = tkinter.Label(
                self.action_options_frame,
                text="Takeoff height:",
            font=text_font
            )
            takeoff_height_entry = tkinter.Entry(
                self.action_options_frame,
                validate="key",
                validatecommand=vcmd_numeric
            )

            def on_ok_btn_click():
                try:
                    self.takeoff_height = float(takeoff_height_entry.get())
                except ValueError:
                    takeoff_height_entry.configure(
                        bg="red"
                    )

                    return

                self.action_options_window.destroy()
                self.action_options_window = None
                self.action_options_frame = None

                self.node.send_takeoff_action_request(self.takeoff_height)

            ok_btn = tkinter.Button(
                self.action_options_frame,
                text="OK",
                command=on_ok_btn_click
            )

            cancel_btn = tkinter.Button(
                self.action_options_frame,
                text="Cancel",
                command=on_cancel_btn_click
            )

            takeoff_label.grid()
            takeoff_height_label.grid()
            takeoff_height_entry.grid()
            ok_btn.grid()
            cancel_btn.grid()

        if action == "Landing":
            landing_label = tkinter.Label(
                self.action_options_frame,
                text="Landing options",
            font=text_font
            )

            def on_ok_btn_click():
                self.action_options_window.destroy()
                self.action_options_window = None
                self.action_options_frame = None

                self.node.send_landing_action_request()

            ok_btn = tkinter.Button(
                self.action_options_frame,
                text="OK",
                command=on_ok_btn_click
            )

            cancel_btn = tkinter.Button(
                self.action_options_frame,
                text="Cancel",
                command=on_cancel_btn_click
            )

            landing_label.grid()
            ok_btn.grid()
            cancel_btn.grid()

        elif action == "FlyToPosition":
            ftp_label = tkinter.Label(
                self.action_options_frame,
                text="FlyToPosition options",
            font=text_font
            )
            x_label = tkinter.Label(
                self.action_options_frame,
                text="Position x:",
            font=text_font
            )
            x_entry = tkinter.Entry(
                self.action_options_frame,
                validate="key",
                validatecommand=vcmd_numeric
            )
            y_label = tkinter.Label(
                self.action_options_frame,
                text="Position y:",
            font=text_font
            )
            y_entry = tkinter.Entry(
                self.action_options_frame,
                validate="key",
                validatecommand=vcmd_numeric
            )
            z_label = tkinter.Label(
                self.action_options_frame,
                text="Position z:",
            font=text_font
            )
            z_entry = tkinter.Entry(
                self.action_options_frame,
                validate="key",
                validatecommand=vcmd_numeric
            )
            yaw_label = tkinter.Label(
                self.action_options_frame,
                text="Yaw:",
            font=text_font
            )
            yaw_entry = tkinter.Entry(
                self.action_options_frame,
                validate="key",
                validatecommand=vcmd_numeric
            )
            frame_label = tkinter.Label(
                self.action_options_frame,
                text="Target position frame:",
            font=text_font
            )
            frames = [
                self.node.get_parameter("world_frame_id").value,
                self.node.get_parameter("drone_frame_id").value
            ]
            frame_stringvar = tkinter.StringVar(self.action_options_window)
            frame_stringvar.set(frames[0])
            frame_optionmenu = tkinter.OptionMenu(
                self.action_options_frame,
                frame_stringvar,
                *frames
            )

            def on_ok_btn_click():
                fail = False

                self.target_pose = PoseStamped()
                self.target_pose.header.frame_id = frame_stringvar.get()
                try:
                    self.target_pose.pose.position.x = float(x_entry.get())
                except ValueError:
                    x_entry.configure(
                        bg="red"
                    )

                    fail = True

                try:
                    self.target_pose.pose.position.y = float(y_entry.get())
                except ValueError:
                    y_entry.configure(
                        bg="red"
                    )

                    fail = True

                try:
                    self.target_pose.pose.position.z = float(z_entry.get())
                except ValueError:
                    z_entry.configure(
                        bg="red"
                    )

                    fail = True

                try:
                    eul = [0, 0, float(yaw_entry.get())]
                    quat = eulToQuat(eul)
                except ValueError:
                    yaw_entry.configure(
                        bg="red"
                    )

                    fail = True

                if fail:
                    return

                self.target_pose.pose.orientation.w = quat[0]
                self.target_pose.pose.orientation.x = quat[1]
                self.target_pose.pose.orientation.y = quat[2]
                self.target_pose.pose.orientation.z = quat[3]

                self.action_options_window.destroy()
                self.action_options_window = None
                self.action_options_frame = None

                self.node.send_fly_to_position_action_request(self.target_pose)

            ok_btn = tkinter.Button(
                self.action_options_frame,
                text="OK",
                command=on_ok_btn_click
            )

            cancel_btn = tkinter.Button(
                self.action_options_frame,
                text="Cancel",
                command=on_cancel_btn_click
            )

            ftp_label.grid()
            x_label.grid()
            x_entry.grid()
            y_label.grid()
            y_entry.grid()
            z_label.grid()
            z_entry.grid()
            yaw_label.grid()
            yaw_entry.grid()
            frame_label.grid()
            frame_optionmenu.grid()
            ok_btn.grid()
            cancel_btn.grid()

        elif action == "FlyUnderCable":
            fuc_label = tkinter.Label(
                self.action_options_frame,
                text="FlyUnderCable options",
            font=text_font
            )
            id_label = tkinter.Label(
                self.action_options_frame,
                text="Cable ID:",
            font=text_font
            )
            cable_ids = self.node.get_cable_ids()
            cable_id_stringvar = tkinter.StringVar(self.action_options_window)
            cable_id_stringvar.set(cable_ids[0])
            cable_id_optionmenu = tkinter.OptionMenu(
                self.action_options_frame,
                cable_id_stringvar,
                *cable_ids
            )
            distance_label = tkinter.Label(
                self.action_options_frame,
                text="Target cable distance:",
            font=text_font
            )
            distance_entry = tkinter.Entry(
                self.action_options_frame,
                validate="key",
                validatecommand=vcmd_numeric
            )

            def on_ok_btn_click():
                fail = False

                try:
                    self.target_cable_distance = float(distance_entry.get())
                except ValueError:
                    distance_entry.configure(
                        bg="red"
                    )

                    fail = True

                try:
                    self.target_cable_id = int(cable_id_stringvar.get())
                except ValueError:
                    cable_id_optionmenu.configure(
                        bg="red"
                    )

                    fail = True

                if fail:
                    return

                self.action_options_window.destroy()
                self.action_options_window = None
                self.action_options_frame = None

                self.node.send_fly_under_cable_action_request(self.target_cable_id, self.target_cable_distance)

            ok_btn = tkinter.Button(
                self.action_options_frame,
                text="OK",
                command=on_ok_btn_click
            )

            cancel_btn = tkinter.Button(
                self.action_options_frame,
                text="Cancel",
                command=on_cancel_btn_click
            )

            fuc_label.grid()
            id_label.grid()
            cable_id_optionmenu.grid()
            distance_label.grid()
            distance_entry.grid()
            ok_btn.grid()
            cancel_btn.grid()

        elif action == "CableLanding":
            cl_label = tkinter.Label(
                self.action_options_frame,
                text="CableLanding options",
            font=text_font
            )
            id_label = tkinter.Label(
                self.action_options_frame,
                text="Cable ID:",
            font=text_font
            )
            cable_ids = self.node.get_cable_ids()
            cable_id_stringvar = tkinter.StringVar(self.action_options_window)
            cable_id_stringvar.set(cable_ids[0])
            cable_id_optionmenu = tkinter.OptionMenu(
                self.action_options_frame,
                cable_id_stringvar,
                *cable_ids
            )

            def on_ok_btn_click():
                fail = False

                try:
                    self.target_cable_id = int(cable_id_stringvar.get())
                except ValueError:
                    cable_id_optionmenu.configure(
                        bg="red"
                    )

                    fail = True

                if fail:
                    return

                self.action_options_window.destroy()
                self.action_options_window = None
                self.action_options_frame = None

                self.node.send_cable_landing_action_request(self.target_cable_id)

            ok_btn = tkinter.Button(
                self.action_options_frame,
                text="OK",
                command=on_ok_btn_click
            )

            cancel_btn = tkinter.Button(
                self.action_options_frame,
                text="Cancel",
                command=on_cancel_btn_click
            )

            cl_label.grid()
            id_label.grid()
            cable_id_optionmenu.grid()
            ok_btn.grid()
            cancel_btn.grid()

        elif action == "CableTakeoff":
            ct_label = tkinter.Label(
                self.action_options_frame,
                text="CableTakeoff options",
            font=text_font
            )
            distance_label = tkinter.Label(
                self.action_options_frame,
                text="Target cable distance:",
            font=text_font
            )
            distance_entry = tkinter.Entry(
                self.action_options_frame,
                validate="key",
                validatecommand=vcmd_numeric
            )

            def on_ok_btn_click():
                fail = False

                try:
                    self.target_cable_distance = float(distance_entry.get())
                except ValueError:
                    distance_entry.configure(
                        bg="red"
                    )

                    fail = True

                if fail:
                    return

                self.action_options_window.destroy()
                self.action_options_window = None
                self.action_options_frame = None

                self.node.send_cable_takeoff_action_request(self.target_cable_distance)

            ok_btn = tkinter.Button(
                self.action_options_frame,
                text="OK",
                command=on_ok_btn_click
            )

            cancel_btn = tkinter.Button(
                self.action_options_frame,
                text="Cancel",
                command=on_cancel_btn_click
            )

            ct_label.grid()
            distance_label.grid()
            distance_entry.grid()
            ok_btn.grid()
            cancel_btn.grid()

        elif action == "FlyAlongCable":
            fac_label = tkinter.Label(
                self.action_options_frame,
                text="FlyAlongCable options",
            font=text_font
            )
            dist_label = tkinter.Label(
                self.action_options_frame,
                text="Flight distance:",
            font=text_font
            )
            dist_entry = tkinter.Entry(
                self.action_options_frame,
                validate="key",
                validatecommand=vcmd_numeric
            )
            vel_label = tkinter.Label(
                self.action_options_frame,
                text="Flight velocity:",
            font=text_font
            )
            vel_entry = tkinter.Entry(
                self.action_options_frame,
                validate="key",
                validatecommand=vcmd_numeric
            )
            inv_label = tkinter.Label(
                self.action_options_frame,
                text="Invert flight direction:",
            font=text_font
            )
            inv_dir = tkinter.BooleanVar(self.action_options_window)
            inv_cb = tkinter.Checkbutton(
                self.action_options_frame,
                variable=inv_dir,
                onvalue=True,
                offvalue=False
            )

            def on_ok_btn_click():
                fail = False

                try:
                    self.flight_distance = float(dist_entry.get())
                except ValueError:
                    dist_entry.configure(
                        bg="red"
                    )

                    fail = True

                try:
                    self.flight_velocity = float(vel_entry.get())
                except ValueError:
                    vel_entry.configure(
                        bg="red"
                    )

                    fail = True

                if fail:
                    return

                invert_direction = inv_dir.get()

                self.node.get_logger().info("Invert direction: {}".format(invert_direction))

                self.node.send_fly_along_cable_request(self.flight_distance, self.flight_velocity, invert_direction)

                self.action_options_window.destroy()
                self.action_options_window = None
                self.action_options_frame = None

            ok_btn = tkinter.Button(
                self.action_options_frame,
                text="OK",
                command=on_ok_btn_click
            )

            cancel_btn = tkinter.Button(
                self.action_options_frame,
                text="Cancel",
                command=on_cancel_btn_click
            )

            fac_label.grid()
            dist_label.grid()
            dist_entry.grid()
            vel_label.grid()
            vel_entry.grid()
            inv_label.grid()
            inv_cb.grid()
            ok_btn.grid()
            cancel_btn.grid()

        elif action == "DoubleCableLanding":
            cl_label = tkinter.Label(
                self.action_options_frame,
                text="DoubleCableLanding options",
            font=text_font
            )

            cable_ids = self.node.get_cable_ids()

            first_id_label = tkinter.Label(
                self.action_options_frame,
                text="First cable ID:",
            font=text_font
            )
            first_cable_id_stringvar = tkinter.StringVar(self.action_options_window)
            first_cable_id_stringvar.set(cable_ids[0])
            first_cable_id_optionmenu = tkinter.OptionMenu(
                self.action_options_frame,
                first_cable_id_stringvar,
                *cable_ids
            )

            second_id_label = tkinter.Label(
                self.action_options_frame,
                text="Second cable ID:",
            font=text_font
            )
            second_cable_id_stringvar = tkinter.StringVar(self.action_options_window)
            second_cable_id_stringvar.set(cable_ids[0])
            second_cable_id_optionmenu = tkinter.OptionMenu(
                self.action_options_frame,
                second_cable_id_stringvar,
                *cable_ids
            )

            first_cable_id = None
            second_cable_id = None

            def on_ok_btn_click():
                fail = False

                try:
                    first_cable_id = int(first_cable_id_stringvar.get())
                except ValueError:
                    first_cable_id_optionmenu.configure(
                        bg="red"
                    )

                    fail = True

                try:
                    second_cable_id = int(second_cable_id_stringvar.get())
                except ValueError:
                    second_cable_id_optionmenu.configure(
                        bg="red"
                    )

                    fail = True

                if fail:
                    return

                self.action_options_window.destroy()
                self.action_options_window = None
                self.action_options_frame = None

                self.node.send_double_cable_landing_action_request(first_cable_id, second_cable_id)

            ok_btn = tkinter.Button(
                self.action_options_frame,
                text="OK",
                command=on_ok_btn_click
            )

            cancel_btn = tkinter.Button(
                self.action_options_frame,
                text="Cancel",
                command=on_cancel_btn_click
            )

            cl_label.grid()
            first_id_label.grid()
            first_cable_id_optionmenu.grid()
            second_id_label.grid()
            second_cable_id_optionmenu.grid()
            ok_btn.grid()
            cancel_btn.grid()

            
    def cancel_action(self):
        self.node.cancel_action()

    def validate_numeric_and_empty(self, action, index, value_if_allowed,
                       prior_value, text, validation_type, trigger_type, widget_name):
        if value_if_allowed == "\b" or value_if_allowed == "" or value_if_allowed == "-":
            return True
        try:
            float(value_if_allowed)
            return True
        except ValueError:
            return False

    def spin_node(self):
        while True:
            if self.end:
                break

            rclpy.spin_once(self.node)

    def set_execute_button_state(self):
        if self.action_status == "Idle" or self.action_status == "Cancelled" or self.action_status == "Success":
            self.execute_action_button["state"] = "normal"
        else:
            self.execute_action_button["state"] = "disabled"

        self.execute_action_button.after(25, self.set_execute_button_state)

    def set_cancel_button_state(self):
        if self.action_status == "Idle" or self.action_status == "Cancelled" or self.action_status == "Success":
            self.cancel_action_button["state"] = "disabled"
        elif self.current_action == "Takeoff" or self.current_action == "Landing" or self.current_action == "DisarmOnCable" or self.current_action == "ArmOnCable":
            self.cancel_action_button["state"] = "disabled"
        else:
            self.cancel_action_button["state"] = "normal"

        self.cancel_action_button.after(25, self.set_cancel_button_state)

    def put_control_state(self):
        state = self.node.get_control_state()

        self.control_state_value_label.configure(text=state)
        
        self.control_state_value_label.after(100, self.put_control_state)

    def put_target_cable_id(self):
        cable_id = self.node.get_target_cable_id()

        self.target_cable_id_value_label.configure(text=str(cable_id))

        self.target_cable_id_value_label.after(100, self.put_target_cable_id)

    def put_battery_voltage(self):
        voltage = self.node.get_battery_voltage()

        self.battery_voltage_value_label.configure(text=str(voltage))

        self.battery_voltage_value_label.after(100, self.put_battery_voltage)

    def put_charging_power(self):
        power = self.node.get_charging_power()

        self.charging_power_value_label.configure(text=str(power))

        self.charging_power_value_label.after(100, self.put_charging_power)

    def put_charger_operating_mode(self):
        mode = self.node.get_charger_operating_mode()

        text = "Unknown"

        if mode == ChargerOperatingMode.OPERATING_MODE_1:
            text = "Mode 1"
        elif mode == ChargerOperatingMode.OPERATING_MODE_2:
            text = "Mode 2"
        elif mode == ChargerOperatingMode.OPERATING_MODE_3:
            text = "Mode 3"
        elif mode == ChargerOperatingMode.OPERATING_MODE_4:
            text = "Mode 4"
        elif mode == ChargerOperatingMode.OPERATING_MODE_5:
            text = "Mode 5"
        elif mode == ChargerOperatingMode.OPERATING_MODE_6:
            text = "Mode 6"
        elif mode == ChargerOperatingMode.OPERATING_MODE_7:
            text = "Mode 7"
        elif mode == ChargerOperatingMode.OPERATING_MODE_8:
            text = "Mode 8"
        elif mode == ChargerOperatingMode.OPERATING_MODE_OPEN:
            text = "Open"

        self.charger_operating_mode_value_label.configure(text=text)

        self.charger_operating_mode_value_label.after(100, self.put_charger_operating_mode)

    def put_charger_status(self):
        status = self.node.get_charger_status()

        text = "Unknown"

        if status == ChargerStatus.CHARGER_STATUS_CHARGING:
            text = "Charging"
        elif status == ChargerStatus.CHARGER_STATUS_DISABLED:
            text = "Disabled"
        elif status == ChargerStatus.CHARGER_STATUS_FULLY_CHARGED:
            text = "Fully charged"

        self.charger_status_value_label.configure(text=text)

        self.charger_status_value_label.after(100, self.put_charger_status)

    def put_gripper_status(self):
        status = "open" if self.node.get_gripper_status().gripper_status == GripperStatus.GRIPPER_STATUS_OPEN else "closed"
        self.gripper_status_value_label.configure(text=status)

        if not self.end:
            self.root.after(100, self.put_gripper_status)

    def put_cont_mission_orch_state(self):
        state = self.node.get_cont_mission_orch_state()

        self.cont_mission_orch_state_value_label.configure(text=state)

        self.cont_mission_orch_state_value_label.after(100, self.put_cont_mission_orch_state)

    def put_action_status(self):
        self.current_action, self.action_status = self.node.get_action_status()

        self.current_action_value_label.configure(text=self.current_action)
        self.action_status_value_label.configure(text=self.action_status)
        
        self.action_status_label.after(100, self.put_action_status)

    def put_img(self):
        pl_tuples = []
        pl_quat = None
        self.node.pl_lock_.acquire(blocking=True)
        for tuple in self.node.powerline_tuples_:
            pl_tuples.append((tuple[0], tuple[1]))
        pl_quat = self.node.powerline_quat_
        self.node.pl_lock_.release()

        rotated_tuples = []

        if pl_quat is None:
            pl_quat = [1, 0, 0, 0]

        if len(pl_tuples) == 0:
            pl_tuples.append((0, [0, 0, 0]))

        if pl_quat is not None:
            rotm = quatToMat(pl_quat).transpose()

            for tuple in pl_tuples:
                point = tuple[1]
                point = np.matmul(rotm, point)
                new_tuple = (tuple[0], point)
                rotated_tuples.append(new_tuple)

            points_y = [rotated_tuples[i][1][1] for i in range(len(rotated_tuples))]
            points_z = [rotated_tuples[i][1][2] for i in range(len(rotated_tuples))]
            points_id = [rotated_tuples[i][0] for i in range(len(rotated_tuples))]

            fig, ax = plt.subplots()
            ax.scatter(points_y, points_z, linewidth=0.000001, color='green', label='Powerlines (#ID)')
            ax.scatter(0, 0, linewidth=0.000001, color='red', label='Ego', marker='X')

            for i, txt in enumerate(points_id):
                ax.annotate(txt, (points_y[i], points_z[i]))



            target = self.node.get_target()
            if target is not None: # and (target[0]**2 + target[1]**2 + target[2]**2)**0.5 > 0.1:
                target = np.matmul(rotm, target)
                ax.scatter(target[1], target[2], linewidth=0.000001, color='blue', label='Target', marker='X')
                ax.annotate("Target", (target[1], target[2]))


            traj = self.node.get_trajectory()
            if len(traj) > 0:
                traj_y = []
                traj_z = []
                for point in traj:
                    point = np.matmul(rotm, point)
                    traj_y.append(point[1])
                    traj_z.append(point[2])
                ax.plot(traj_y, traj_z, color='yellow', label='Trajectory')


            plt.axis('square')

            if (len(points_y)>0):
                plt.xlim([min([min(points_y)-2,-2]), max([max(points_y)+2, 2])])


            fig.canvas.draw()

            img = np.frombuffer(fig.canvas.tostring_rgb(), dtype=np.uint8)
            # img = np.fromstring(fig.canvas.tostring_rgb(), dtype=np.uint8, sep='')
            img  = img.reshape(fig.canvas.get_width_height()[::-1] + (3,))

            # img is rgb, convert to opencv's default bgr
            img = cv.cvtColor(img,cv.COLOR_RGB2BGR)

            plt.cla()
            plt.clf()
            plt.close('all')

            if img is not None:
                img = Image.fromarray(img)
                imgtk = ImageTk.PhotoImage(image=img)
                self.label_viz.imgtk = imgtk
                self.label_viz.configure(image=imgtk)

        self.label_viz.after(100, self.put_img)



###############################################################################
# Main
###############################################################################


if __name__ == "__main__":
    rclpy.init()

    print("Starting IIIGui")
    gui = IIIGui()

    gui.main_loop()

    # Destroy the node explicitly
    # (optional - otherwise it will be done automatically
    # when the garbage collector destroys the node object)
    rclpy.shutdown()

    
