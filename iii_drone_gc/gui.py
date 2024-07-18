#!/usr/bin/python3

###############################################################################
# Imports
###############################################################################

###############################################################################
# ROS2:
import rclpy
from rclpy.parameter import ParameterValue

###############################################################################
# ROS2 interfaces:
from sensor_msgs.msg import Image
from geometry_msgs.msg import PoseStamped
from nav_msgs.msg import Path

###############################################################################
# Custom modules:
from iii_drone_core.utils.math import *
from iii_drone_configuration.parameter_handler import ParameterHandler
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
from tkinter import Toplevel, ttk
from PIL import ImageTk, Image

###############################################################################
# Python:
import os
from threading import Thread
from time import sleep
import yaml
import subprocess
from datetime import datetime

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

        # self.config = yaml.safe_load(open(self.node.config_file_path,"r").read())

        self.config_node_keys = []
        # for key in self.config.keys():
        #     key = str(key)
        #     if (key == "/**" or key == "tf" or key == "iii_gui"):
        #         continue

        #     self.config_node_keys.append(key)
        
        self.parameter_yaml = self.node.get_parameter_yaml()
        
        self.parameter_handler = ParameterHandler.from_raw_yaml_string(self.parameter_yaml)
        
        self.node.add_on_set_parameter_event_callback(self.on_set_parameter_event)

        # self.target_pose = PoseStamped()
        # self.target_cable_id = 0
        # self.target_cable_distance = self.node.get_parameter("target_cable_distance_default").get_parameter_value().double_value
        # self.flight_distance = 1.
        # self.flight_velocity = 1.
        # self.invert_flight_direction = False

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
        
        self.vcmd_int = (self.root.register(self.validate_int_and_empty),
                    '%d', '%i', '%P', '%s', '%S', '%v', '%V', '%W')

        # Diagnostics:
        self.diagnostics_frame = tkinter.Frame(self.root, bg="white")
        self.diagnostics_frame.grid(row=0, column=0)

        # Data:
        self.diagnostics_data_frame = tkinter.Frame(self.diagnostics_frame, bg="white")
        self.diagnostics_data_frame.grid(row=0, column=0)

        self.system_diagnostics_label = tkinter.Label(
            self.diagnostics_data_frame,
            text="System diagnostics:",
            background="grey",
            font=text_font
        )
        self.system_diagnostics_label.grid(row=0, column=0, sticky=tkinter.W+tkinter.E)


        self.system_diagnostics_frame = tkinter.Frame(self.diagnostics_data_frame, bg="white")
        self.system_diagnostics_frame.grid(row=1, column=0, pady=10)

        row_cnt = 0

        self.drone_location_label = tkinter.Label(
            self.system_diagnostics_frame, 
            text="Drone location:",
            background="white",
            font=text_font
        )
        self.drone_location_label.grid(row=row_cnt, column=0)
        self.drone_location_value_label = tkinter.Label(
            self.system_diagnostics_frame,
            text=self.node.get_drone_location(),
            background="cyan",
            font=text_font
        )
        self.drone_location_value_label.grid(row=row_cnt, column=1)
        
        row_cnt += 1

        self.put_drone_location()
        
        self.armed_label = tkinter.Label(
            self.system_diagnostics_frame,
            text="Armed:",
            background="white",
            font=text_font
        )
        self.armed_label.grid(row=row_cnt, column=0)
        self.armed_value_label = tkinter.Label(
            self.system_diagnostics_frame,
            text=str(self.node.get_armed()),
            background="cyan",
            font=text_font
        )
        self.armed_value_label.grid(row=row_cnt, column=1)
        
        row_cnt += 1
        
        self.put_armed()
        
        self.offboard_label = tkinter.Label(
            self.system_diagnostics_frame,
            text="Offboard:",
            background="white",
            font=text_font
        )
        self.offboard_label.grid(row=row_cnt, column=0)
        self.offboard_value_label = tkinter.Label(
            self.system_diagnostics_frame,
            text=str(self.node.get_offboard()),
            background="cyan",
            font=text_font
        )
        self.offboard_value_label.grid(row=row_cnt, column=1)
        
        row_cnt += 1
        
        self.put_offboard()
        
        self.has_target_label = tkinter.Label(
            self.system_diagnostics_frame,
            text="Has target:",
            background="white",
            font=text_font
        )
        self.has_target_label.grid(row=row_cnt, column=0)
        self.has_target_value_label = tkinter.Label(
            self.system_diagnostics_frame,
            text=str(self.node.get_has_target()),
            background="cyan",
            font=text_font
        )
        self.has_target_value_label.grid(row=row_cnt, column=1)
        
        row_cnt += 1
        
        self.put_has_target()
        
        self.target_position_known_label = tkinter.Label(
            self.system_diagnostics_frame,
            text="Target position known:",
            background="white",
            font=text_font
        )
        self.target_position_known_label.grid(row=row_cnt, column=0)
        self.target_position_known_value_label = tkinter.Label(
            self.system_diagnostics_frame,
            text=str(self.node.get_target_position_known()),
            background="cyan",
            font=text_font
        )
        self.target_position_known_value_label.grid(row=row_cnt, column=1)
        
        row_cnt += 1
        
        self.put_target_position_known()
        
        self.on_cable_id_label = tkinter.Label(
            self.system_diagnostics_frame,
            text="On cable ID:",
            background="white",
            font=text_font
        )
        self.on_cable_id_label.grid(row=row_cnt, column=0)
        self.on_cable_id_value_label = tkinter.Label(
            self.system_diagnostics_frame,
            text=str(self.node.get_on_cable_id()),
            background="cyan",
            font=text_font
        )
        self.on_cable_id_value_label.grid(row=row_cnt, column=1)
        
        row_cnt += 1
        
        self.put_on_cable_id()
        
        self.ground_altitude_estimate_label = tkinter.Label(
            self.system_diagnostics_frame,
            text="Ground altitude estimate:",
            background="white",
            font=text_font
        )
        self.ground_altitude_estimate_label.grid(row=row_cnt, column=0)
        self.ground_altitude_estimate_value_label = tkinter.Label(
            self.system_diagnostics_frame,
            # text=str(self.node.get_ground_altitude_estimate()),
            # With two decimals:
            text="{:.2f}".format(self.node.get_ground_altitude_estimate()),
            background="cyan",
            font=text_font
        )
        self.ground_altitude_estimate_value_label.grid(row=row_cnt, column=1)
        
        row_cnt += 1
        
        self.put_ground_altitude_estimate()
        
        self.current_maneuver_label = tkinter.Label(
            self.system_diagnostics_frame,
            text="Current maneuver:",
            background="white",
            font=text_font
        )
        self.current_maneuver_label.grid(row=row_cnt, column=0)
        self.current_maneuver_value_label = tkinter.Label(
            self.system_diagnostics_frame,
            text=str(self.node.get_current_maneuver_type()),
            background="cyan",
            font=text_font
        )
        self.current_maneuver_value_label.grid(row=row_cnt, column=1)
        
        row_cnt += 1
        
        self.put_current_maneuver()
        
        self.current_maneuver_status_label = tkinter.Label(
            self.system_diagnostics_frame,
            text="Current maneuver status:",
            background="white",
            font=text_font
        )
        self.current_maneuver_status_label.grid(row=row_cnt, column=0)
        self.current_maneuver_status_value_label = tkinter.Label(
            self.system_diagnostics_frame,
            text=str(self.node.get_current_maneuver_status()),
            background="cyan",
            font=text_font
        )
        self.current_maneuver_status_value_label.grid(row=row_cnt, column=1)
        
        row_cnt += 1
        
        self.put_current_maneuver_status()

        self.maneuver_reference_client_mode_label = tkinter.Label(
            self.system_diagnostics_frame,
            text="Maneuver reference client mode:",
            background="white",
            font=text_font
        )
        self.maneuver_reference_client_mode_label.grid(row=row_cnt, column=0)
        self.maneuver_reference_client_mode_value_label = tkinter.Label(
            self.system_diagnostics_frame,
            text=str(self.node.get_maneuver_reference_client_mode()),
            background="cyan",
            font=text_font
        )
        self.maneuver_reference_client_mode_value_label.grid(row=row_cnt, column=1)
        
        row_cnt += 1
        
        self.put_maneuver_reference_client_mode()
        
        # Charger gripper diagnostics frame:
        self.cg_diagnostics_label = tkinter.Label(
            self.diagnostics_data_frame,
            text="Charger/gripper diagnostics:",
            background="grey",
            font=text_font
        )
        self.cg_diagnostics_label.grid(row=0, column=1, sticky=tkinter.W+tkinter.E)

        self.charger_gripper_diagnostics_frame = tkinter.Frame(self.diagnostics_data_frame, bg="white")
        self.charger_gripper_diagnostics_frame.grid(row=1, column=1, pady=10)

        row_cnt = 0

        self.battery_voltage_label = tkinter.Label(
            self.charger_gripper_diagnostics_frame,
            text="Battery voltage:",
            background="white",
            font=text_font
        )
        self.battery_voltage_label.grid(row=row_cnt, column=0)

        self.battery_voltage_value_label = tkinter.Label(
            self.charger_gripper_diagnostics_frame,
            text=str(self.node.get_battery_voltage()),
            background="cyan",
            font=text_font
        )
        self.battery_voltage_value_label.grid(row=row_cnt, column=1)
        
        row_cnt += 1

        self.put_battery_voltage()

        self.charging_power_label = tkinter.Label(
            self.charger_gripper_diagnostics_frame,
            text="Charging power:",
            background="white",
            font=text_font
        )
        self.charging_power_label.grid(row=row_cnt, column=0)

        self.charging_power_value_label = tkinter.Label(
            self.charger_gripper_diagnostics_frame,
            text=str(self.node.get_charging_power()),
            background="cyan",
            font=text_font
        )
        self.charging_power_value_label.grid(row=row_cnt, column=1)

        row_cnt += 1

        self.put_charging_power()

        self.charger_operating_mode_label = tkinter.Label(
            self.charger_gripper_diagnostics_frame,
            text="Charger operating mode:",
            background="white",
            font=text_font
        )
        self.charger_operating_mode_label.grid(row=row_cnt, column=0)

        self.charger_operating_mode_value_label = tkinter.Label(
            self.charger_gripper_diagnostics_frame,
            text="",
            background="cyan",
            font=text_font
        )
        self.charger_operating_mode_value_label.grid(row=row_cnt, column=1)

        row_cnt += 1

        self.put_charger_operating_mode()

        self.charger_status_label = tkinter.Label(
            self.charger_gripper_diagnostics_frame,
            text="Charger status:",
            background="white",
            font=text_font
        )
        self.charger_status_label.grid(row=row_cnt, column=0)

        self.charger_status_value_label = tkinter.Label(
            self.charger_gripper_diagnostics_frame,
            text="",
            background="cyan",
            font=text_font
        )
        self.charger_status_value_label.grid(row=row_cnt, column=1)

        row_cnt += 1

        self.put_charger_status()


        self.gripper_status_label = tkinter.Label(
            self.charger_gripper_diagnostics_frame,
            text="Gripper status:",
            background="white",
            font=text_font
        )
        self.gripper_status_label.grid(row=row_cnt, column=0)

        gripper_status = "open" if self.node.get_gripper_status().gripper_status == GripperStatus.GRIPPER_STATUS_OPEN else "closed"

        self.gripper_status_value_label = tkinter.Label(
            self.charger_gripper_diagnostics_frame,
            text=gripper_status,
            background="cyan",
            font=text_font
        )
        self.gripper_status_value_label.grid(row=row_cnt, column=1)

        row_cnt += 1

        self.put_gripper_status()

        # Perception diagnostics:
        self.perception_diagnostics_label = tkinter.Label(
            self.diagnostics_data_frame,
            text="Perception diagnostics:",
            background="grey",
            font=text_font
        )
        self.perception_diagnostics_label.grid(row=0, column=2, sticky=tkinter.W+tkinter.E)
        
        self.perception_diagnostics_frame = tkinter.Frame(self.diagnostics_data_frame, bg="white")
        self.perception_diagnostics_frame.grid(row=1, column=2, pady=10)
        
        row_cnt = 0
        
        self.pl_mapper_state_label = tkinter.Label(
            self.perception_diagnostics_frame,
            text="PL mapper state:",
            background="white",
            font=text_font
        )
        self.pl_mapper_state_label.grid(row=row_cnt, column=0)
        self.pl_mapper_state_value_label = tkinter.Label(
            self.perception_diagnostics_frame,
            text=self.node.get_pl_mapper_state(),
            background="cyan",
            font=text_font
        )
        self.pl_mapper_state_value_label.grid(row=row_cnt, column=1)
        
        row_cnt += 1
        
        self.put_pl_mapper_state()
        
        self.pl_dir_computer_status_label = tkinter.Label(
            self.perception_diagnostics_frame,
            text="PL dir computer status:",
            background="white",
            font=text_font
        )
        self.pl_dir_computer_status_label.grid(row=row_cnt, column=0)
        self.pl_dir_computer_status_value_label = tkinter.Label(
            self.perception_diagnostics_frame,
            text=self.node.get_pl_dir_computer_status(),
            background="cyan",
            font=text_font
        )
        self.pl_dir_computer_status_value_label.grid(row=row_cnt, column=1)
        
        row_cnt += 1
        
        self.put_pl_dir_computer_status()
        
        self.hough_transformer_status_label = tkinter.Label(
            self.perception_diagnostics_frame,
            text="Hough transformer status:",
            background="white",
            font=text_font
        )
        self.hough_transformer_status_label.grid(row=row_cnt, column=0)
        self.hough_transformer_status_value_label = tkinter.Label(
            self.perception_diagnostics_frame,
            text=self.node.get_hough_transformer_status(),
            background="cyan",
            font=text_font
        )
        self.hough_transformer_status_value_label.grid(row=row_cnt, column=1)
        
        row_cnt += 1
        
        self.put_hough_transformer_status()

        self.stored_powerline_status_label = tkinter.Label(
            self.perception_diagnostics_frame,
            text="Stored powerline status:",
            background="white",
            font=text_font
        )
        self.stored_powerline_status_label.grid(row=row_cnt, column=0)
        self.stored_powerline_status_value_label = tkinter.Label(
            self.perception_diagnostics_frame,
            text=self.node.get_stored_powerline_status(),
            background="cyan",
            font=text_font
        )
        self.stored_powerline_status_value_label.grid(row=row_cnt, column=1)
        
        row_cnt += 1
        
        self.put_stored_powerline_status()

        self.container_frame = tkinter.Frame(self.root, bg="white")
        self.container_frame.grid(row=1, column=0)
        
        # Powerline visualization:
        # Container Frame for PL Visualization and Title
        self.pl_viz_container_frame = tkinter.Frame(self.container_frame, bg="#007BFF")
        self.pl_viz_container_frame.grid(row=0, column=0, sticky="n")  # Stick to the north to limit size
        # self.diagnostics_frame.grid_rowconfigure(1, weight=1)
        self.pl_viz_title = tkinter.Label(self.pl_viz_container_frame, text="Perceived Powerlines", font=("Arial", 16, "bold"), bg="#007BFF", relief="solid", borderwidth=1)
        self.pl_viz_title.grid(row=0, column=0, sticky="new")
        self.pl_viz_frame = tkinter.Frame(self.pl_viz_container_frame, bg="#007BFF", width=400, height=300, bd=2, relief="solid")
        self.pl_viz_frame.grid(row=1, column=0, sticky="nsew", padx=10, pady=10)
        self.label_viz = tkinter.Label(self.pl_viz_frame)
        self.label_viz.grid(row=0, column=0, sticky="nsew")

        self.put_img()




        # Action control:
        self.action_control_frame = tkinter.Frame(self.container_frame, bg="#000000")
        self.action_control_frame.grid(row=0, column=1)

        self.action_diagnostics_frame = tkinter.Frame(self.action_control_frame, bg="#000000")
        self.action_diagnostics_frame.grid(row=0, column=0,columnspan=2)

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

        self.action_views = {}
        
        col_cnt = 0
        
        self.action_views["gripper"] = {}

        self.action_views["gripper"]["button"] = tkinter.Button(
            self.action_view_select_buttons_frame,
            text="Gripper ctrl",
            command=self.on_gripper_action_view_select,
            bg=normal_button_bg,
            fg=normal_button_fg,
            font=buttons_font,
        )
        self.action_views["gripper"]["button"].config(state="normal")
        self.action_views["gripper"]["button"].grid(row=0, column=col_cnt)
        
        col_cnt += 1
        
        self.action_views["perception"] = {}

        self.action_views["perception"]["button"] = tkinter.Button(
            self.action_view_select_buttons_frame,
            text="Perception ctrl",
            command=self.on_perception_action_view_select,
            bg=normal_button_bg,
            fg=normal_button_fg,
            font=buttons_font,
        )
        self.action_views["perception"]["button"].config(state="normal")
        self.action_views["perception"]["button"].grid(row=0, column=col_cnt)
        
        col_cnt += 1
        
        self.action_views["configuration"] = {}

        self.action_views["configuration"]["button"] = tkinter.Button(
            self.action_view_select_buttons_frame,
            text="Configuration",
            command=self.on_configuration_action_view_select,
            bg=normal_button_bg,
            fg=normal_button_fg,
            font=buttons_font,
        )
        self.action_views["configuration"]["button"].config(state="normal")
        self.action_views["configuration"]["button"].grid(row=0, column=col_cnt)

        self.current_action_view = "gripper"

        # Gripper control action view
        self.action_views["gripper"]["frame"] = tkinter.Frame(self.action_control_frame, bg="#000000")
        
        self.gripper_action_view_label = tkinter.Label(
            self.action_views["gripper"]["frame"],
            text="Gripper control:",
            bg="grey",
            font=text_font
        )
        self.gripper_action_view_label.grid(row=0, column=0, columnspan=2, sticky=tkinter.W+tkinter.E)

        # Open gripper:
        self.gripper_frame = tkinter.Frame(self.action_views["gripper"]["frame"], bg="white")
        self.gripper_frame.grid(row=1, column=0, pady=10)

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

        # Perception action view
        self.action_views["perception"]["frame"] = tkinter.Frame(self.action_control_frame, bg="#000000")

        row_cnt = 0

        # Reset checkbox:
        self.pl_mapper_reset_var = tkinter.BooleanVar()
        self.pl_mapper_reset_checkbox = tkinter.Checkbutton(
            self.action_views["perception"]["frame"],
            text="Reset PL mapper",
            variable=self.pl_mapper_reset_var
        )
        self.pl_mapper_reset_checkbox.grid(row=row_cnt, column=0)

        row_cnt += 1
        
        # Start pl mapper:
        self.start_pl_mapper_button = tkinter.Button(
            self.action_views["perception"]["frame"],
            text="Start PL mapper",
            command=self.execute_start_pl_mapper,
            bg=normal_button_bg,
            fg=normal_button_fg,
            font=buttons_font,
        )
        self.start_pl_mapper_button.grid(row=row_cnt, column=0, pady=10)
        
        row_cnt += 1
        
        # Stop pl mapper:
        self.stop_pl_mapper_button = tkinter.Button(
            self.action_views["perception"]["frame"],
            text="Stop PL mapper",
            command=self.execute_stop_pl_mapper,
            bg=normal_button_bg,
            fg=normal_button_fg,
            font=buttons_font,
        )
        self.stop_pl_mapper_button.grid(row=row_cnt, column=0, pady=10)
        
        row_cnt += 1
        
        # Pause pl mapper:
        self.pause_pl_mapper_button = tkinter.Button(
            self.action_views["perception"]["frame"],
            text="Pause PL mapper",
            command=self.execute_pause_pl_mapper,
            bg=normal_button_bg,
            fg=normal_button_fg,
            font=buttons_font,
        )
        self.pause_pl_mapper_button.grid(row=row_cnt, column=0, pady=10)
        
        row_cnt += 1
        
        # Freeze pl mapper:
        self.freeze_pl_mapper_button = tkinter.Button(
            self.action_views["perception"]["frame"],
            text="Freeze PL mapper",
            command=self.execute_freeze_pl_mapper,
            bg=normal_button_bg,
            fg=normal_button_fg,
            font=buttons_font,
        )
        self.freeze_pl_mapper_button.grid(row=row_cnt, column=0, pady=10)
        
        row_cnt += 1
        
        # Put spacing bettwen the buttons before the next row
        self.pl_mapper_spacing_label = tkinter.Label(
            self.action_views["perception"]["frame"],
            text="",
            bg="#000000",
            font=text_font
        )
        self.pl_mapper_spacing_label.grid(row=row_cnt, column=0)
        
        row_cnt += 1

        # Update powerline overview:
        self.update_powerline_overview_timeout_label = tkinter.Label(
            self.action_views["perception"]["frame"],
            text="Update powerline overview timeout (s):",
            font=text_font
        )
        self.update_powerline_overview_timeout_label.grid(row=row_cnt, column=0)
        
        self.update_powerline_overview_timeout_var = tkinter.StringVar()
        
        self.update_powerline_overview_timeout_entry = tkinter.Entry(
            self.action_views["perception"]["frame"],
            textvariable=self.update_powerline_overview_timeout_var,
            validate="key",
            validatecommand=self.vcmd_int
        )
        self.update_powerline_overview_timeout_entry.grid(row=row_cnt, column=1)
        
        row_cnt += 1
        
        self.update_powerline_overview_button = tkinter.Button(
            self.action_views["perception"]["frame"],
            text="Update powerline overview",
            command=self.execute_update_powerline_overview,
            bg=normal_button_bg,
            fg=normal_button_fg,
            font=buttons_font,
        )
        self.update_powerline_overview_button.grid(row=row_cnt, column=0, pady=10)
        
        row_cnt += 1
            

        # # Set target cable id:
        # self.set_target_cable_id_button = tkinter.Button(
        #     self.high_level_action_view_frame,
        #     text="Set target cable ID",
        #     command=self.execute_set_target_cable_id,
        #     bg=normal_button_bg,
        #     fg=normal_button_fg,
        #     font=buttons_font,
        # )

        # self.set_target_cable_id_button.grid(row=0, column=0, pady=10)

        # self.set_target_cable_id_parameters_frame = tkinter.Frame(self.high_level_action_view_frame, bg="#000000")
        # self.set_target_cable_id_parameters_frame.grid(row=0, column=1)

        # self.set_target_cable_id_label = tkinter.Label(
        #     self.set_target_cable_id_parameters_frame,
        #     text="Target cable id: ",
        #     font=text_font
        # )
        # self.set_target_cable_id_label.grid(row=0, column=0)

        # self.set_target_cable_id_stringvar = tkinter.StringVar(self.high_level_action_view_frame)
        # self.set_target_cable_id_stringvar.set(self.cable_ids[0] if len(self.cable_ids) > 0 else "")
        # self.set_target_cable_id_optionmenu = tkinter.OptionMenu(
        #     self.set_target_cable_id_parameters_frame,
        #     self.set_target_cable_id_stringvar,
        #     tuple(self.cable_ids) if len(self.cable_ids) > 0 else (""),
        # )
        # self.set_target_cable_id_optionmenu.config(font=text_font)
        # self.set_target_cable_id_optionmenu_menu = self.root.nametowidget(self.set_target_cable_id_optionmenu.menuname)
        # self.set_target_cable_id_optionmenu_menu.config(font=text_font)
        # self.update_set_target_cable_id_optionmenu()
        # self.set_target_cable_id_optionmenu.grid(row=0, column=1)

        # # Initiate charging:
        # self.initiate_charging_button = tkinter.Button(
        #     self.high_level_action_view_frame,
        #     text="Initiate charging",
        #     command=self.execute_initiate_charging,
        #     bg=normal_button_bg,
        #     fg=normal_button_fg,
        #     disabledforeground=disabled_button_fg,
        #     font=buttons_font,
        # )
    
        # self.initiate_charging_button.grid(row=1, column=0, pady=10)

        # # Interrupt charging:
        # self.interrupt_charging_button = tkinter.Button(
        #     self.high_level_action_view_frame,
        #     text="Interrupt charging",
        #     command=self.execute_interrupt_charging,
        #     bg=normal_button_bg,
        #     fg=normal_button_fg,
        #     disabledforeground=disabled_button_fg,
        #     font=buttons_font,
        # )

        # self.interrupt_charging_button.grid(row=2, column=0, pady=10)

        # # Prolong charging:
        # self.prolong_charging_button = tkinter.Button(
        #     self.high_level_action_view_frame,
        #     text="Prolong charging",
        #     command=self.execute_prolong_charging,
        #     bg=normal_button_bg,
        #     fg=normal_button_fg,
        #     font=buttons_font,
        # )

        # self.prolong_charging_button.grid(row=3, column=0, pady=10)

        # self.prolong_charging_parameters_frame = tkinter.Frame(self.high_level_action_view_frame, bg="#000000")
        # self.prolong_charging_parameters_frame.grid(row=3, column=1)

        # self.prolong_charging_mode_label = tkinter.Label(
        #     self.prolong_charging_parameters_frame,
        #     text="Prolong charging mode: ",
        #     font=text_font
        # )
        # self.prolong_charging_mode_label.grid(row=0, column=0)

        # self.prolong_charging_modes = ["Until interrupted", "Clear"]
        # self.prolong_charging_mode_stringvar = tkinter.StringVar(self.high_level_action_view_frame)
        # self.prolong_charging_mode_stringvar.set(self.prolong_charging_modes[0])
        # self.prolong_charging_mode_optionmenu = tkinter.OptionMenu(
        #     self.prolong_charging_parameters_frame,
        #     self.prolong_charging_mode_stringvar,
        #     *self.prolong_charging_modes,
        # )
        # self.prolong_charging_mode_optionmenu.config(font=text_font)
        # self.prolong_charging_mode_optionmenu_menu = self.root.nametowidget(self.prolong_charging_mode_optionmenu.menuname)
        # self.prolong_charging_mode_optionmenu_menu.config(font=text_font)
        # self.prolong_charging_mode_optionmenu.grid(row=0, column=1)
        
        # Configuration action view:
        self.action_views["configuration"]["frame"] = tkinter.Frame(self.action_control_frame, bg="#000000")
        
        # Configuration parameters:
        self.parameter_tree = ttk.Treeview(self.action_views["configuration"]["frame"], columns=('Name', 'Value'), show='headings', height=10)
        self.parameter_tree.heading('Name', text='Name')
        self.parameter_tree.heading('Value', text='Value')
        self.parameter_tree.column('Name', width=750, anchor='center')
        self.parameter_tree.column('Value', width=200, anchor='center')

        self.parameter_scrollbar = ttk.Scrollbar(self.action_views["configuration"]["frame"], orient='vertical', command=self.parameter_tree.yview)
        self.parameter_tree.configure(yscrollcommand=self.parameter_scrollbar.set)

        self.parameter_tree.grid(row=0, column=0, sticky='nsew')
        self.parameter_scrollbar.grid(row=0, column=1, sticky='ns')

        self.parameter_tree.bind('<Double-1>', self.modify_parameter)

        self.fill_parameter_table() 

        # Save parameters:
        self.save_parameters_button = tkinter.Button(
            self.action_views["configuration"]["frame"],
            text="Save parameters on drone",
            command=self.save_parameters_remote,
            bg=normal_button_bg,
            fg=normal_button_fg,
            font=buttons_font,
        )
        
        self.save_parameters_button.grid(row=1, column=0, pady=10)
        
        self.save_parameters_local_button = tkinter.Button(
            self.action_views["configuration"]["frame"],
            text="Save parameters locally",
            command=self.save_parameters_local,
            bg=normal_button_bg,
            fg=normal_button_fg,
            font=buttons_font,
        )
        
        self.save_parameters_local_button.grid(row=2, column=0, pady=10)
        
        # Load parameters:
        self.load_parameters_button = tkinter.Button(
            self.action_views["configuration"]["frame"],
            text="Load parameters from drone",
            command=self.load_parameters_remote,
            bg=normal_button_bg,
            fg=normal_button_fg,
            font=buttons_font,
        )
        
        self.load_parameters_button.grid(row=3, column=0, pady=10)

        # Put action view:
        self.on_configuration_action_view_select()


        # Update actions:
        self.update_available_actions()
        
    def save_parameters_remote(self):
        def save_parameters():
            try:
                file_name_str = file_name.get()
                select_as_default_bool = select_as_default.get()
                overwrite_bool = overwrite.get()
                success, saved_file, message = self.node.save_parameters_remote(
                    file_name_str,
                    set_as_default=select_as_default_bool,
                    overwrite=overwrite_bool
                )

                if not success:
                    raise Exception(message)
                
                top.destroy()
                
                msg = tkinter.Toplevel(self.action_views["configuration"]["frame"])
                tkinter.Label(msg, text="Parameters saved successfully on the drone to {}.".format(saved_file)).pack()
                tkinter.Button(msg, text='OK', command=msg.destroy).pack()
                
            except Exception as e:
                # Display error message in popup:
                error = tkinter.Toplevel(self.action_views["configuration"]["frame"])
                tkinter.Label(error, text=str(e)).pack()
                tkinter.Button(error, text='OK', command=error.destroy).pack()
                
        top = tkinter.Toplevel(self.action_views["configuration"]["frame"])
        tkinter.Label(top, text='Save parameters on drone?').pack()
        
        file_name = tkinter.StringVar()
        tkinter.Label(top, text='File name:').pack()
        tkinter.Entry(top, textvariable=file_name).pack()
        # Bool:
        select_as_default = tkinter.BooleanVar()
        tkinter.Checkbutton(top, text='Select as default', variable=select_as_default).pack()
        overwrite = tkinter.BooleanVar()
        tkinter.Checkbutton(top, text='Overwrite', variable=overwrite).pack()

        tkinter.Button(top, text='Save', command=save_parameters).pack()
        
    def load_parameters_remote(self):
        def load_parameter_file():
            try:
                file_name_str = file_name.get()
                select_as_default_bool = select_as_default.get()
                success, message = self.node.load_parameters_remote(file_name_str, set_as_default=select_as_default_bool)

                if not success:
                    raise Exception(message)
                
                top.destroy()
                
                self.update_parameter_table()
                
                msg = tkinter.Toplevel(self.action_views["configuration"]["frame"])
                tkinter.Label(msg, text="Parameters loaded successfully on the drone.").pack()
                tkinter.Button(msg, text='OK', command=msg.destroy).pack()
                
            except Exception as e:
                # Display error message in popup:
                error = tkinter.Toplevel(self.action_views["configuration"]["frame"])
                tkinter.Label(error, text=str(e)).pack()
                tkinter.Button(error, text='OK', command=error.destroy).pack()
                
        top = tkinter.Toplevel(self.action_views["configuration"]["frame"])
        tkinter.Label(top, text='Load parameters on drone').pack()
        
        file_name = tkinter.StringVar()
        tkinter.Label(top, text='File name:').pack()
        # Select file from dropdown:
        file_names = self.node.get_parameter_files_remote()
        if len(file_names) == 0:
            raise Exception("No parameter files found on drone.")
        
        current_file_name = self.node.get_current_parameter_file()
        
        if current_file_name not in file_names:
            raise Exception("Current parameter file {} not found on drone.".format(current_file_name))
    
        file_name.set(file_names[file_names.index(current_file_name)])
        tkinter.OptionMenu(top, file_name, *file_names).pack()

        # Bool:
        select_as_default = tkinter.BooleanVar()
        tkinter.Checkbutton(top, text='Select as default', variable=select_as_default).pack()

        tkinter.Button(top, text='Load', command=load_parameter_file).pack()
        
    def save_parameters_local(self):
        now = datetime.now()
        # Format as yyyymmdd_hhmm:
        dt_string = now.strftime("%Y%m%d_%H%M%S")
        
        file_name = "parameters_gc_" + dt_string + ".yaml"
        
        home = os.environ['HOME']

        dir=os.path.join(home, ".config/iii_drone/parameters")
        
        # If dir doesn't exist, create it:
        if not os.path.exists(dir):
            os.makedirs(dir)
            
        path = os.path.join(dir, file_name)
        
        self.parameter_handler.save_parameters(path)
        
        message = "Parameters saved locally to {}.".format(path)
        
        msg = tkinter.Toplevel(self.action_views["configuration"]["frame"])
        tkinter.Label(msg, text=str(message)).pack()
        tkinter.Button(msg, text='OK', command=msg.destroy).pack()

    def modify_parameter(self, event):
        item = self.parameter_tree.selection()[0]
        name, value = self.parameter_tree.item(item, 'values')

        param_dict = self.parameter_handler.get_param(name)
        param_type = param_dict['type']
        
        if not (param_type == 'bool' or param_type == 'int' or param_type == 'float' or param_type == 'string'):
            print("Cannot modify parameter of type " + param_type + ".")
            return

        def save_new_value():
            try:
                new_value = None
                if param_type == 'bool':
                    new_value = bool(value_entry.get())
                elif param_type == 'int':   
                    new_value = int(value_entry.get())
                elif param_type == 'float':
                    new_value = float(value_entry.get())
                elif param_type == 'string':
                    new_value = str(value_entry.get())
                    
                success, message = self.node.set_parameter_from_gc_remote(name, str(new_value))
                
                if not success:
                    raise Exception(message)
                
                self.parameter_handler.set_param(name, new_value, True, force_constant=True)
                top.destroy()

                msg = tkinter.Toplevel(self.action_views["configuration"]["frame"])
                tkinter.Label(msg, text=str(message)).pack()
                tkinter.Button(msg, text='OK', command=msg.destroy).pack()
            
            except Exception as e:
                # Display error message in popup:
                error = tkinter.Toplevel(self.action_views["configuration"]["frame"])
                tkinter.Label(error, text=str(e)).pack()
                tkinter.Button(error, text='OK', command=error.destroy).pack()

            self.update_parameter_table()
            
        top = tkinter.Toplevel(self.action_views["configuration"]["frame"])
        tkinter.Label(top, text='New value for ' + name).pack()

        if param_type == 'bool':
            value = bool(value)
            value_entry = tkinter.Checkbutton(top, text='True', variable=value)
            value_entry.pack()
            
        elif param_type == 'int':
            value = int(value)
            value_entry = tkinter.Entry(top, validate="key", validatecommand=self.vcmd_int)
            value_entry.pack()
            value_entry.insert(0, value)
            
        elif param_type == 'float':
            value = float(value)
            value_entry = tkinter.Entry(top, validate="key", validatecommand=self.vcmd_numeric)
            value_entry.pack()
            value_entry.insert(0, value)
            
        elif param_type == 'string':
            if "options" in param_dict:
                value_entry = tkinter.OptionMenu(top, value, *param_dict["options"])
                # Set selected value of value_entry to current value:
                value_entry["menu"].entryconfig(param_dict["options"].index(value))
                value_entry.pack()
            else:
                value_entry = tkinter.Entry(top)
                value_entry.pack()
                value_entry.insert(0, value)
            
        else:
            print("Cannot modify parameter of type " + param_type + ".")

        tkinter.Button(top, text='Save', command=save_new_value).pack()
        
    def fill_parameter_table(self):
        for name, param in self.parameter_handler.get_all_params().items():
            self.parameter_tree.insert('', 'end', values=(name, param['value']))
            
    def update_parameter_table(self):
        for item in self.parameter_tree.get_children():
            self.parameter_tree.delete(item)
        self.fill_parameter_table()

    def update_available_actions(self):
        gripper_status: GripperStatus = self.node.get_gripper_status()

        # OpenGripper:
        if self.action_status == "Executing":
            self.open_gripper_button.config(state="disabled")

        else:
            self.open_gripper_button.config(state="normal")

        # CloseGripper:
        if self.action_status == "Executing":
            self.close_gripper_button.config(state="disabled")

        else:
            self.close_gripper_button.config(state="normal")

        if self.action_status == "Executing":
            self.start_pl_mapper_button.config(state="disabled")
            self.stop_pl_mapper_button.config(state="disabled")
            self.pause_pl_mapper_button.config(state="disabled")
            self.freeze_pl_mapper_button.config(state="disabled")
            self.update_powerline_overview_button.config(state="disabled")
            
        else:
            cable_ids = self.node.get_cable_ids()
            
            if len(cable_ids) < 4:
                self.update_powerline_overview_button.config(state="disabled")
            else:
                self.update_powerline_overview_button.config(state="normal")
                
            self.start_pl_mapper_button.config(state="normal")
            self.stop_pl_mapper_button.config(state="normal")
            self.pause_pl_mapper_button.config(state="normal")
            self.freeze_pl_mapper_button.config(state="normal")

        if not self.end:
            self.root.after(100, self.update_available_actions)

    def on_gripper_action_view_select(self):
        for key, value in self.action_views.items():
            if key == "gripper":
                continue
            
            value["frame"].grid_forget()
            
        self.action_views["gripper"]["frame"].grid(row=2, column=0, columnspan=2, pady=10)
        
    def on_perception_action_view_select(self):
        for key, value in self.action_views.items():
            if key == "perception":
                continue
            
            value["frame"].grid_forget()
            
        self.action_views["perception"]["frame"].grid(row=2, column=0, columnspan=2, pady=10)

    def on_configuration_action_view_select(self):
        for key, value in self.action_views.items():
            if key == "configuration":
                continue
            
            value["frame"].grid_forget()
        
        self.action_views["configuration"]["frame"].grid(row=2, column=0, columnspan=2, sticky=tkinter.W+tkinter.E, pady=10)

    def execute_open_gripper(self):
        self.node.send_open_gripper_command()

    def execute_close_gripper(self):
        self.node.send_close_gripper_command()

    def execute_start_pl_mapper(self):
        reset = self.pl_mapper_reset_var.get()
        
        self.node.send_start_pl_mapper_command(reset)
        
    def execute_stop_pl_mapper(self):
        reset = self.pl_mapper_reset_var.get()
        self.node.send_stop_pl_mapper_command(reset)
        
    def execute_pause_pl_mapper(self):
        reset = self.pl_mapper_reset_var.get()
        self.node.send_pause_pl_mapper_command(reset)
        
    def execute_freeze_pl_mapper(self):
        reset = self.pl_mapper_reset_var.get()
        self.node.send_freeze_pl_mapper_command(reset)
        
    def execute_update_powerline_overview(self):
        timeout_s = int(self.update_powerline_overview_timeout_var.get())
        self.node.send_update_powerline_overview_command(timeout_s)

    def main_loop(self):
        try:
            while True:
                rclpy.spin_once(self.node, timeout_sec=0.1)
                self.root.update_idletasks()
                self.root.update()

        except KeyboardInterrupt:
            self.end = True
            self.node.destroy_node()

    # def set_params(self):
    #     self.params_options_window = Toplevel(self.root)
    #     self.params_options_window.title("Params options")
    #     self.params_options_frame = tkinter.Frame(self.params_options_window, bg="white")

    #     self.params_options_frame.grid()

    #     node_key = self.param_stringvar.get()

    #     params = []
    #     for key in self.config[node_key][node_key]["ros__parameters"].keys():
    #         params.append(str(key))

    #     param_stringvar = tkinter.StringVar(self.root)
    #     param_stringvar.set(params[0])
    #     param_optionmenu = tkinter.OptionMenu(
    #         self.params_options_frame,
    #         param_stringvar,
    #         *params
    #     )

    #     param_optionmenu.grid()

    #     value_label = tkinter.Label(
    #         self.params_options_frame,
    #         text="Parameter value:",
    #         font=text_font
    #     )
    #     value_entry = tkinter.Entry(
    #         self.params_options_frame
    #     )

    #     value_label.grid()
    #     value_entry.grid()

    #     def on_cancel_btn_click():
    #         self.params_options_window.destroy()
    #         self.params_options_window = None
    #         self.params_options_frame = None

    #     def on_ok_btn_click():
    #         value = value_entry.get()
    #         param = param_stringvar.get()

    #         parameter_type = type(self.config[node_key][node_key]["ros__parameters"][param])

    #         success = True

    #         try:
    #             value = parameter_type(value)
    #         except ValueError:
    #             success = False

    #         if success:
    #             node_name = "/" + node_key + "/" + node_key

    #             bashCommand = str("ros2 param set " + str(node_name) + " " + str(param) + " " + str(value))
    #             process = subprocess.Popen(bashCommand.split(), stdout=subprocess.PIPE)
    #             output, error = process.communicate()

    #             self.node.get_logger().info(str(output))
    #             self.node.get_logger().info(str(error))

    #         self.params_options_window.destroy()
    #         self.params_options_window = None
    #         self.params_options_frame = None

    #     ok_btn = tkinter.Button(
    #         self.params_options_frame,
    #         text="OK",
    #         command=on_ok_btn_click,
    #         font=buttons_font,
    #     )

    #     cancel_btn = tkinter.Button(
    #         self.params_options_frame,
    #         text="Cancel",
    #         command=on_cancel_btn_click,
    #         font=buttons_font,
    #     )

    #     ok_btn.grid()
    #     cancel_btn.grid()

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
        
    def validate_int_and_empty(self, action, index, value_if_allowed,
                        prior_value, text, validation_type, trigger_type, widget_name):
        if value_if_allowed == "\b" or value_if_allowed == "" or value_if_allowed == "-":
            return True
        try:
            int(value_if_allowed)
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

    def put_drone_location(self):
        location = self.node.get_drone_location()

        self.drone_location_value_label.configure(text=location)
        
        self.drone_location_value_label.after(100, self.put_drone_location)
        
    def put_armed(self):
        armed = self.node.get_armed()

        self.armed_value_label.configure(text=str(armed))

        self.armed_value_label.after(100, self.put_armed)
        
    def put_offboard(self):
        offboard = self.node.get_offboard()

        self.offboard_value_label.configure(text=str(offboard))

        self.offboard_value_label.after(100, self.put_offboard)

    def put_on_cable_id(self):
        cable_id = self.node.get_on_cable_id()

        self.on_cable_id_value_label.configure(text=str(cable_id))

        self.on_cable_id_value_label.after(100, self.put_on_cable_id)

    def put_target_position_known(self):
        known = self.node.get_target_position_known()

        self.target_position_known_value_label.configure(text=str(known))

        self.target_position_known_value_label.after(100, self.put_target_position_known)

    def put_has_target(self):
        has_target = self.node.get_has_target()

        self.has_target_value_label.configure(text=str(has_target))

        self.has_target_value_label.after(100, self.put_has_target)

    def put_ground_altitude_estimate(self):
        altitude = self.node.get_ground_altitude_estimate()

        self.ground_altitude_estimate_value_label.configure(text="{:.2f}".format(altitude))

        self.ground_altitude_estimate_value_label.after(100, self.put_ground_altitude_estimate)

    def put_current_maneuver(self):
        maneuver = self.node.get_current_maneuver_type()

        self.current_maneuver_value_label.configure(text=maneuver)

        self.current_maneuver_value_label.after(100, self.put_current_maneuver)
        
    def put_current_maneuver_status(self):
        status = self.node.get_current_maneuver_status()

        self.current_maneuver_status_value_label.configure(text=status)

        self.current_maneuver_status_value_label.after(100, self.put_current_maneuver_status)
        
    def put_maneuver_reference_client_mode(self):
        mode = self.node.get_maneuver_reference_client_mode()

        self.maneuver_reference_client_mode_value_label.configure(text=mode)

        self.maneuver_reference_client_mode_value_label.after(100, self.put_maneuver_reference_client_mode)
        
        
    def put_pl_mapper_state(self):
        state = self.node.get_pl_mapper_state()

        self.pl_mapper_state_value_label.configure(text=state)

        self.pl_mapper_state_value_label.after(100, self.put_pl_mapper_state)
        
    def put_pl_dir_computer_status(self):
        status = self.node.get_pl_dir_computer_status()

        self.pl_dir_computer_status_value_label.configure(text=status)

        self.pl_dir_computer_status_value_label.after(100, self.put_pl_dir_computer_status)
        
    def put_hough_transformer_status(self):
        status = self.node.get_hough_transformer_status()

        self.hough_transformer_status_value_label.configure(text=status)

        self.hough_transformer_status_value_label.after(100, self.put_hough_transformer_status)
        
    def put_stored_powerline_status(self):
        status = self.node.get_stored_powerline_status()

        self.stored_powerline_status_value_label.configure(text=status)

        self.stored_powerline_status_value_label.after(100, self.put_stored_powerline_status)
        
    def put_battery_voltage(self):
        voltage = self.node.get_battery_voltage()

        self.battery_voltage_value_label.configure(text="{:.2f}".format(voltage))

        self.battery_voltage_value_label.after(100, self.put_battery_voltage)

    def put_charging_power(self):
        power = self.node.get_charging_power()

        self.charging_power_value_label.configure(text="{:.2f}".format(power))

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
        
    def on_set_parameter_event(
        self,
        param_name: str,
        param_value: ParameterValue
    ):
        if param_name == "default_parameter_file":
            return
        try:
            param_dict = self.parameter_handler.get_param(param_name)
            
            param_type = param_dict["type"]
            
            if param_type == "bool":
                param_value = param_value.bool_value
            elif param_type == "int":
                param_value = param_value.integer_value
            elif param_type == "float":
                param_value = param_value.double_value
            elif param_type == "string":
                param_value = param_value.string_value
            elif param_type == "bool_array":
                param_value = param_value.bool_array_value
            elif param_type == "int_array":
                param_value = param_value.integer_array_value
            elif param_type == "float_array":
                param_value = param_value.double_array_value
            elif param_type == "string_array":
                param_value = param_value.string_array_value
            else:
                raise Exception("Unknown parameter type: {}".format(param_type))

            self.parameter_handler.set_param(param_name, param_value, True)

        except Exception as e:
            self.node.get_logger().fatal("Failed to set parameter: {}".format(e))
            raise e

        self.update_parameter_table()

###############################################################################
# Main
###############################################################################

def main():
    rclpy.init()

    print("Starting IIIGui")
    gui = IIIGui()

    gui.main_loop()

    # Destroy the node explicitly
    # (optional - otherwise it will be done automatically
    # when the garbage collector destroys the node object)
    rclpy.shutdown()


if __name__ == "__main__":
    main()