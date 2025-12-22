# RottenFM (Vencord user plugin)

Show your Navidrome now-playing as Discord Rich Presence, with album art and metadata from Last.fm.

This is an alternative to running a python app on your server for it, it also does not required access to a discord user token.

## Requirements

- A local Vencord source build (custom plugins require building from source).
- Navidrome reachable from your Discord client (localhost/LAN/VPN is fine).
- A Last.fm API key (optional; the plugin falls back to a shared key).

## Install 

1. In your Vencord source tree, create `src/userplugins/` if it does not exist.
2. Copy `rottenfm.tsx` into `src/userplugins/rottenfm.tsx`.
3. Rebuild Vencord and restart Discord.

Reference: https://docs.vencord.dev/installing/custom-plugins/

## Settings

- Navidrome URL, username, password.
- Discord Application ID (used for Rich Presence assets).
- Polling interval.
- Last.fm API key (optional).
- Activity text formatting and type.

## Notes

- Album art uses Last.fm and is always public.
- If you set `hideWithListening`, the plugin will not override Spotify or other listening presences.
- This plugin is meant for private use. It likely does not meet Vencord's official plugin rules.

## FAQ

**Why do I see a Content Security Policy error and no presence?**  
Discord blocks direct HTTP requests unless the host is explicitly allowed. Use the "Allow Navidrome Host" button in the plugin settings and then fully restart Discord. If your setup still fails, ensure Navidrome is served over HTTPS (either directly or via a reverse proxy), as some CSP setups only permit secure origins.

**Disclaimer:** Allowing a host relaxes Discord's Content Security Policy for that domain. Only allow domains you control or fully trust.
