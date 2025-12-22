/*
     RottenFM - Navidrome Rich Presence for Discord
*/

import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { Activity, ActivityAssets, ActivityButton } from "@vencord/discord-types";
import { ActivityFlags, ActivityStatusDisplayType, ActivityType } from "@vencord/discord-types/enums";
import { ApplicationAssetUtils, AuthenticationStore, FluxDispatcher, PresenceStore } from "@webpack/common";

interface TrackData {
    id: string;
    title: string;
    artist: string;
    album: string;
    duration?: number;
}

interface LastfmInfo {
    imageUrl?: string;
    trackUrl?: string;
    album?: string;
    artist?: string;
}

const logger = new Logger("RottenFM");

const LASTFM_API = "https://ws.audioscrobbler.com/2.0/";
const DEFAULT_LASTFM_API_KEY = "790c37d90400163a5a5fe00d6ca32ef0";

function setActivity(activity: Activity | null) {
    FluxDispatcher.dispatch({
        type: "LOCAL_ACTIVITY_UPDATE",
        activity,
        socketId: "RottenFM",
    });
}

const settings = definePluginSettings({
    navidromeUrl: {
        type: OptionType.STRING,
        description: "Navidrome base URL (e.g. http://localhost:4533)",
    },
    navidromeUsername: {
        type: OptionType.STRING,
        description: "Navidrome username",
    },
    navidromePassword: {
        type: OptionType.STRING,
        description: "Navidrome password (stored in Vencord settings)",
    },
    pollInterval: {
        type: OptionType.SLIDER,
        description: "Polling interval (seconds)",
        markers: [1, 2, 3, 5, 10, 15, 30],
        default: 5,
    },
    discordAppId: {
        type: OptionType.STRING,
        description: "Discord application ID used for Rich Presence assets",
    },
    activityType: {
        type: OptionType.SELECT,
        description: "Which type of activity",
        options: [
            { label: "Playing", value: ActivityType.PLAYING, default: true },
            { label: "Listening", value: ActivityType.LISTENING },
        ],
    },
    statusDisplayType: {
        description: "Show the track / artist name in the member list",
        type: OptionType.SELECT,
        options: [
            { label: "Don't show", value: "off", default: true },
            { label: "Show artist name", value: "artist" },
            { label: "Show track name", value: "track" },
        ],
    },
    activityName: {
        type: OptionType.STRING,
        description: "Activity name",
        default: "Navidrome",
    },
    detailsFormat: {
        type: OptionType.STRING,
        description: "Details format string",
        default: "{title}",
    },
    stateFormat: {
        type: OptionType.STRING,
        description: "State format string",
        default: "{artist} · {album}",
    },
    enableTimestamps: {
        type: OptionType.BOOLEAN,
        description: "Enable timestamps",
        default: true,
    },
    useLastfm: {
        type: OptionType.BOOLEAN,
        description: "Use Last.fm for artwork and metadata",
        default: true,
    },
    lastfmApiKey: {
        type: OptionType.STRING,
        description: "Last.fm API key (optional; falls back to a shared key)",
    },
    hideWithActivity: {
        description: "Hide RottenFM if you have any other presence",
        type: OptionType.BOOLEAN,
        default: false,
    },
    hideWithListening: {
        description: "Hide RottenFM if another listening activity is active",
        type: OptionType.BOOLEAN,
        default: true,
    },
});

function formatTemplate(template: string, track: TrackData) {
    return template
        .replaceAll("{title}", track.title)
        .replaceAll("{artist}", track.artist)
        .replaceAll("{album}", track.album);
}

function getLastfmApiKey() {
    return settings.store.lastfmApiKey || DEFAULT_LASTFM_API_KEY;
}

async function fetchLastfmInfo(track: TrackData): Promise<LastfmInfo | null> {
    try {
        const params = new URLSearchParams({
            method: "track.getInfo",
            api_key: getLastfmApiKey(),
            artist: track.artist,
            track: track.title,
            format: "json",
        });

        const res = await fetch(`${LASTFM_API}?${params}`);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

        const json = await res.json();
        const data = json.track;
        if (!data) return null;

        const images = data.album?.image ?? [];
        const image =
            images.find((img: any) => img.size === "extralarge" && img["#text"]) ||
            images.find((img: any) => img.size === "large" && img["#text"]) ||
            images.find((img: any) => img.size === "medium" && img["#text"]);

        return {
            imageUrl: image?.["#text"],
            trackUrl: data.url,
            album: data.album?.title,
            artist: data.artist?.name,
        };
    } catch (err) {
        logger.error("Last.fm lookup failed", err);
        return null;
    }
}

async function fetchNowPlaying(): Promise<TrackData | null> {
    const { navidromeUrl, navidromeUsername, navidromePassword } = settings.store;

    if (!navidromeUrl || !navidromeUsername || !navidromePassword) return null;

    try {
        const params = new URLSearchParams({
            u: navidromeUsername,
            p: navidromePassword,
            f: "json",
            v: "1.16.1",
            c: "rottenfm",
        });

        const res = await fetch(`${navidromeUrl.replace(/\/$/, "")}/rest/getNowPlaying?${params}`);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

        const json = await res.json();
        const payload = json["subsonic-response"];
        if (!payload || payload.status !== "ok") return null;

        const entry = payload.nowPlaying?.entry;
        if (!entry) return null;

        const list = Array.isArray(entry) ? entry : [entry];
        const userEntry = list.find((item: any) => item.username === navidromeUsername);
        if (!userEntry) return null;

        return {
            id: userEntry.id,
            title: userEntry.title,
            artist: userEntry.artist,
            album: userEntry.album,
            duration: userEntry.duration,
        };
    } catch (err) {
        logger.error("Navidrome now playing failed", err);
        return null;
    }
}

async function getApplicationAsset(appId: string, key: string): Promise<string | undefined> {
    if (!appId || !key) return undefined;
    const ids = await ApplicationAssetUtils.fetchAssetIds(appId, [key]);
    return ids?.[0];
}

export default definePlugin({
    name: "RottenFM",
    description: "Show Navidrome now-playing as Discord Rich Presence (Last.fm artwork)",
    authors: [{ name: "rottenfm" }],

    settings,

    start() {
        this.currentTrackId = null;
        this.startedAt = null;
        this.lastfmCache = new Map();
        this.updatePresence();
        this.updateInterval = setInterval(() => this.updatePresence(), settings.store.pollInterval * 1000);
    },

    stop() {
        clearInterval(this.updateInterval);
        setActivity(null);
    },

    async updatePresence() {
        if (this.isUpdating) return;
        this.isUpdating = true;

        try {
            if (settings.store.hideWithActivity) {
                const activities = PresenceStore.getActivities(AuthenticationStore.getId()) ?? [];
                if (activities.some((a: any) => a.application_id && a.application_id !== settings.store.discordAppId)) {
                    setActivity(null);
                    return;
                }
            }

            if (settings.store.hideWithListening) {
                const activities = PresenceStore.getActivities(AuthenticationStore.getId()) ?? [];
                if (activities.some((a: any) => a.type === ActivityType.LISTENING && a.application_id !== settings.store.discordAppId)) {
                    setActivity(null);
                    return;
                }
            }

            const track = await fetchNowPlaying();
            if (!track) {
                setActivity(null);
                return;
            }

            if (track.id !== this.currentTrackId) {
                this.currentTrackId = track.id;
                this.startedAt = Date.now();
            }

            const activity = await this.buildActivity(track);
            setActivity(activity);
        } finally {
            this.isUpdating = false;
        }
    },

    async buildActivity(track: TrackData): Promise<Activity> {
        const assets: ActivityAssets = {};
        const buttons: ActivityButton[] = [];

        let lastfmInfo: LastfmInfo | null = null;
        if (settings.store.useLastfm) {
            const cacheKey = `${track.artist}::${track.title}`;
            lastfmInfo = this.lastfmCache.get(cacheKey);
            if (!lastfmInfo) {
                lastfmInfo = await fetchLastfmInfo(track);
                if (lastfmInfo) this.lastfmCache.set(cacheKey, lastfmInfo);
            }
        }

        const appId = settings.store.discordAppId;
        const imageUrl = lastfmInfo?.imageUrl;

        if (appId && imageUrl) {
            const asset = await getApplicationAsset(appId, imageUrl);
            if (asset) {
                assets.large_image = asset;
                assets.large_text = track.album;
            }
        }

        if (lastfmInfo?.trackUrl) {
            buttons.push({
                label: "Open on Last.fm",
                url: lastfmInfo.trackUrl,
            });
        }

        const activity: Activity = {
            application_id: appId || "0",
            name: settings.store.activityName,
            details: formatTemplate(settings.store.detailsFormat, track),
            state: formatTemplate(settings.store.stateFormat, track),
            type: settings.store.activityType,
            flags: ActivityFlags.INSTANCE,
            status_display_type: {
                off: ActivityStatusDisplayType.NAME,
                artist: ActivityStatusDisplayType.STATE,
                track: ActivityStatusDisplayType.DETAILS,
            }[settings.store.statusDisplayType],
            assets: Object.keys(assets).length ? assets : undefined,
            buttons: buttons.length ? buttons.map(v => v.label) : undefined,
            metadata: buttons.length ? { button_urls: buttons.map(v => v.url) } : undefined,
        };

        if (settings.store.enableTimestamps && track.duration && this.startedAt) {
            activity.timestamps = {
                start: this.startedAt,
                end: this.startedAt + track.duration * 1000,
            };
        }

        return activity;
    },
});
