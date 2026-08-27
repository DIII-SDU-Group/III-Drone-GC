import os
from setuptools import find_packages, setup

package_name="iii_drone_gc"
description="The iii_drone_gc package. This package contains the ground control functionality of the III-Drone system."
maintainer="Frederik Falk Nyboe"
maintainer_email="ffn@sdu.dk"
license="proprietary"
version="2.2"

setup(
    name=package_name,
    version=version,
    # Packages to export
    packages=find_packages(exclude=["test"]),
    # Files we want to install, specifically launch files
    data_files=[
        # Install marker file in the package index
        ('share/ament_index/resource_index/packages', ['resource/' + package_name]),
        # Include package metadata
        (os.path.join('share', package_name), ['package.xml']),
    ],
    # This is important as well
    install_requires=[
        'setuptools',
        'fastapi>=0.110,<1',
        'httpx>=0.27,<1',
        'pydantic>=2,<3',
        'uvicorn>=0.29,<1',
        'websockets>=12,<16',
        'zeroconf>=0.132,<1',
    ],
    tests_require=['pytest'],
    zip_safe=True,
    maintainer=maintainer,
    maintainer_email=maintainer_email,
    description=description,
    license=license,
    # Like the CMakeLists add_executable macro, you can add your python
    # scripts here.
    entry_points={
        "console_scripts": [
            "gui = iii_drone_gc.gui:main",
            "iii-gc-proxy = iii_drone_gc.v2_proxy.main:main",
            "iii-gc-companion = iii_drone_gc.v2_companion:main",
        ]
    }
)
