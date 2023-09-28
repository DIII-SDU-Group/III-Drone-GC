cmake_minimum_required(VERSION 3.8)
project(iii_drone_gc)

if(CMAKE_COMPILER_IS_GNUCXX OR CMAKE_CXX_COMPILER_ID MATCHES "Clang")
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

set(PYTHON_EXECUTABLES
  scripts/gui.py
)

# find dependencies
find_package(ament_cmake REQUIRED)
find_package(iii_interfaces REQUIRED)

# Install Python modules
ament_python_install_package(${PROJECT_NAME})

install(PROGRAMS 
  ${PYTHON_EXECUTABLES}
  DESTINATION lib/${PROJECT_NAME}
)

ament_package()
