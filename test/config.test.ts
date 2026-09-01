import { describe, expect, it } from "vitest";
import { ConfigError, NETWORKS, PRESET_NAMES, resolveConfig } from "../src/config.js";

describe("resolveConfig", () => {
    it("defaults to the public signet deployment", () => {
        const config = resolveConfig({});
        expect(config.network.name).toBe("signet");
        expect(config.network.arkServerUrl).toBe("https://signet.arkade.sh");
        expect(config.dataDir).toBe(".firstsats");
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
        expect(config.network.name).toBe("signet");
        expect(config.network.arkServerUrl).toBe("http://localhost:7070");
        expect(config.network.esploraUrl).toBe(NETWORKS.signet.esploraUrl);
    });

    it("ignores empty overrides rather than blanking an endpoint", () => {
        const config = resolveConfig({
            FIRSTSATS_ARK_SERVER_URL: "   ",
            FIRSTSATS_DATA_DIR: "",
        });
        expect(config.network.arkServerUrl).toBe(NETWORKS.signet.arkServerUrl);
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
