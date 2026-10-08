# GUI v2 Developer Access

GUI v2 is used on the development and field-test network without application
authentication, runtime tokens, firewall rules, or deployment credentials.
The attending developer can select the Pi runtime directly and use ordinary SSH
for workspace changes.

This does not change flight safety behavior. Vehicle state, disarm, landed, and
mode checks remain enforced by the runtime command handlers.
