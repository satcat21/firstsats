import { describe, expect, it } from "vitest";
import {
    ConfigError,
    DEFAULT_NETWORK,
    NETWORKS,
    PRESET_NAMES,
    resolveConfig,
} from "../src/config.js";

describe("resolveConfig", () => {
    it("defaults to the public mutinynet deployment", () => {
        const config = resolveConfig({});
        expect(config.network.name).toBe(DEFAULT_NETWORK);
        expect(config.network.name).toBe("mutinynet");
        expect(config.network.arkServerUrl).toBe("https://mutinynet.arkade.sh");
        expect(config.dataDir).toBe(".firstsats");
    });

    it("still reaches signet when asked for it by name", () => {
        const config = resolveConfig({ FIRSTSATS_NETWORK: "signet" });
        expect(config.network.arkServerUrl).toBe("https://signet.arkade.sh");
    });

    it("selects a preset by name, case-insensitively", () => {
        expect(resolveConfig({ FIRSTSATS_NETWORK: "MutinyNet" }).network.name).toBe(
            "mutinynet"
        );
    });

    it("rejects an unknown network and lists the valid ones", () => {
        expect(() => resolveConfig({ FIRSTSATS_NETWORK: "mainnet-please" })).toThrow(
            ConfigError
        );
        expect(() => resolveConfig({ FIRSTSATS_NETWORK: "nope" })).toThrow(
            new RegExp(PRESET_NAMES.join(", "))
        );
    });

    it("lets individual endpoints be overridden without changing the preset", () => {
        const config = resolveConfig({
            FIRSTSATS_ARK_SERVER_URL: "http://localhost:7070",
        });
        expect(config.network.name).toBe("mutinynet");
        expect(config.network.arkServerUrl).toBe("http://localhost:7070");
        expect(config.network.esploraUrl).toBe(NETWORKS.mutinynet.esploraUrl);
    });

    it("ignores empty overrides rather than blanking an endpoint", () => {
        const config = resolveConfig({
            FIRSTSATS_ARK_SERVER_URL: "   ",
            FIRSTSATS_DATA_DIR: "",
        });
        expect(config.network.arkServerUrl).toBe(NETWORKS.mutinynet.arkServerUrl);
        expect(config.dataDir).toBe(".firstsats");
    });

    it("gives every preset a reachable-looking endpoint pair", () => {
        for (const name of PRESET_NAMES) {
            const preset = NETWORKS[name];
            expect(preset.arkServerUrl).toMatch(/^https?:\/\//);
            expect(preset.esploraUrl).toMatch(/^https?:\/\//);
        }
    });
});
