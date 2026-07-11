## Mega System Technologies MSNSwitch (UIS-622B)

This module controls the switch over its HTTP/HTTPS API: outlet on/off/reset, the UIS auto-reset watchdog, and polled status for feedbacks and variables.

### Configuration

1. Enter the device's **IP address**.
2. Choose **HTTP or HTTPS** (must match what is enabled on the device; the self-signed HTTPS certificate is accepted automatically).
3. Choose the **API version** to match the device firmware:
   - **Firmware 3207+ (JSON)** — no username/password; access is controlled by the device's IP whitelist (see below).
   - **Older firmware (CGI/XML)** — requires the device's web username and password.
4. Leave **polling** enabled so outlet state, feedbacks, and variables stay current. The poll interval defaults to 5 seconds.

### IP whitelisting (firmware 3207+)

Firmware 3207 replaced API credentials with an IP whitelist — the device only answers API requests from addresses you have allowed:

1. Open the device web UI and go to the **Network Service / API** settings.
2. Enable HTTP (and/or HTTPS) API control.
3. Add the IP address of this computer to the API whitelist.

If this computer is not whitelisted, actions and polling fail (typically HTTP 401/403, and the connection shows a failure status with a whitelist hint). Give this computer a static IP or DHCP reservation so the whitelist entry stays valid.

### How it behaves

- State is polled on the configured interval; after any action the module re-polls after ~0.7 s so buttons update quickly. On/off actions also update feedbacks optimistically.
- **Reset** power-cycles an outlet and only applies to outlets that are currently **ON**. The module skips the command (with a log entry) if the outlet is off.
- **UIS** is the auto-reset watchdog that power-cycles outlets when a monitored internet connection goes down; the UIS action enables or disables it.

### Actions

- **Outlet: on / off / reset** — Outlet 1, Outlet 2, or all outlets
- **Outlet: toggle** — flips Outlet 1 or Outlet 2 based on its last polled state
- **UIS auto-reset: on / off**
- **Send heartbeat** — triggers the device's heartbeat endpoint (used by its heartbeat-monitoring feature)

### Feedbacks

- **Outlet on** — the selected outlet is powered on
- **UIS on** — the auto-reset watchdog is enabled
- **Connected** — the device is reachable

### Variables

- **$(msnswitch:outlet1_name)** / **$(msnswitch:outlet2_name)** — outlet labels as configured on the device
- **$(msnswitch:outlet1_status)** / **$(msnswitch:outlet2_status)** — On / Off
- **$(msnswitch:uis_status)** — On / Off
- **$(msnswitch:connection1_label / _host / _resp / _lost)** — the device's monitored-connection details (label, host, response time in ms, packet loss %); same for **connection2**

### Troubleshooting

- **Connection failure** — check the IP address and that the device is on the network. Try opening `http://<device-ip>/` in a browser from this computer.
- **HTTP 401 / 403 (firmware 3207+)** — this computer's IP is not on the device's API whitelist, or API control is disabled. Fix both in the device web UI.
- **Authentication failed (older firmware)** — verify the username and password.
- **Reset has no effect** — reset only applies to outlets that are already ON.
