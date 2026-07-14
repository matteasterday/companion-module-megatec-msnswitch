## Mega System Technologies MSNSwitch (UIS-622B)

This module controls the switch over its HTTP/HTTPS API: outlet on/off/reset, the UIS auto-reset watchdog, and polled status for feedbacks and variables.

### Configuration

1. Enter the device's **IP address**.
2. Choose **HTTP or HTTPS** (must match what is enabled on the device; the module accepts the device's self-signed HTTPS certificate automatically). Note: the vendor states the device may require a client certificate to be imported into it for HTTPS API access — if HTTPS fails but the web UI works, use HTTP.
3. Enter the device's web **username and password** — both API versions require them (the JSON API sends them with every request).
4. Choose the **API version** to match the device firmware:
   - **Firmware 3207+ (JSON)** — requires the credentials *and* the device's IP whitelist (see below).
   - **Older firmware (CGI/XML)** — requires the credentials only.
5. Leave **polling** enabled so outlet state, feedbacks, and variables stay current. The poll interval defaults to 5 seconds.

### IP whitelisting (firmware 3207+)

On firmware 3207+ the device only answers API requests from addresses you have allowed:

1. Open the device web UI and go to the **Network Service / API** settings.
2. Enable HTTP (and/or HTTPS) API control.
3. Add the IP address of this computer to the API whitelist.

If this computer is not whitelisted or the credentials are wrong, actions and polling fail (typically HTTP 400/401/403, and the connection shows a failure status with a hint). Give this computer a static IP or DHCP reservation so the whitelist entry stays valid.

### How it behaves

- State is polled on the configured interval; after any action the module re-polls after ~0.7 s so buttons update quickly. On/off actions also update feedbacks optimistically.
- **Reset** power-cycles an outlet and only applies to outlets that are currently **ON**. The module skips the command (with a log entry) if the outlet is known to be off.
- **Toggle** (outlet or UIS) needs to know the current state, so it is skipped (with a log entry) until the first successful status poll. On/Off/Toggle are also skipped for outlets configured as **reset-only** on the device.
- **UIS** (Uninterrupted Internet Service) is the auto-reset watchdog that power-cycles outlets when internet connectivity is lost; the UIS action enables or disables it. The switch only resets an outlet when **all** sites assigned to it stop responding, and by default it gives up after 3 power cycles until connectivity returns (configurable on the device as "Number of UIS Resets").

### Actions

- **Outlet: on / off / reset** — Outlet 1, Outlet 2, or all outlets
- **Outlet: toggle** — flips Outlet 1 or Outlet 2 based on its last polled state
- **UIS auto-reset: on / off / toggle**
- **Send heartbeat** — keepalive for the switch's heartbeat monitor. The switch expects the equipment plugged into an outlet to report in periodically; if heartbeats stop, it power-cycles that outlet. Sending a heartbeat from Companion tells the switch the monitored equipment is alive, deferring that auto-reset — it is **not** needed to keep Companion's own connection to the switch active (polling handles that). ⚠️ The heartbeat feature must first be configured in the switch's web interface, and it **arms itself when the first heartbeat arrives** — after that, the switch power-cycles the outlet if heartbeats stop. Don't press this button casually; only use it if you intend to keep sending heartbeats (e.g. from a Companion trigger on an interval). On older CGI/XML firmware this action only *reads* the device's last-heartbeat timestamp (it does not send a trigger), so the arming warning applies to JSON-API firmware only.

### Feedbacks

- **Outlet on** — the selected outlet is powered on
- **UIS on** — the auto-reset watchdog is enabled
- **Connected** — the device is reachable
- **Monitored connection packet loss** — true when a monitored connection's packet loss is at or above the configured threshold (default 50%); useful for an "internet down" warning button

### Variables

The examples below use `msnswitch` — replace it with the label you gave this connection.

- **$(msnswitch:outlet1_name)** / **$(msnswitch:outlet2_name)** — outlet labels as configured on the device
- **$(msnswitch:outlet1_status)** / **$(msnswitch:outlet2_status)** — On / Off
- **$(msnswitch:uis_status)** — On / Off
- **$(msnswitch:last_heartbeat)** — timestamp reported by the device for the last heartbeat sent from this module (empty until one is sent)
- **$(msnswitch:connection1_label / _host / _resp / _lost)** — the device's monitored-connection details (label, host, response time in ms, packet loss %); same for **connection2**

### Troubleshooting

- **Connection failure** — check the IP address and that the device is on the network. Try opening `http://<device-ip>/` in a browser from this computer.
- **HTTP 400 / 401 / 403 (firmware 3207+)** — the username/password is missing or wrong, this computer's IP is not on the device's API whitelist, or API control is disabled. Fix these in the connection config and the device web UI.
- **Authentication failed (older firmware)** — verify the username and password.
- **Reset has no effect** — reset only applies to outlets that are already ON.
