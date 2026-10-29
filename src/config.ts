import * as pulumi from "@pulumi/pulumi";

export interface StackConfig {
    isMinikube: boolean;
    minikubeIp?: string;
    grafanaNodePort: number;
    loadgenEnabled: boolean;
}

/**
 * parseConfig applies defaults and validates raw config values. Kept free of Pulumi runtime calls so it can be
 * unit tested directly.
 */
export function parseConfig(raw: Partial<StackConfig>): StackConfig {
    const grafanaNodePort = raw.grafanaNodePort ?? 30300;
    if (grafanaNodePort < 30000 || grafanaNodePort > 32767) {
        throw new Error(`grafanaNodePort must be within the NodePort range 30000-32767, got ${grafanaNodePort}`);
    }
    return {
        isMinikube: raw.isMinikube ?? false,
        minikubeIp: raw.minikubeIp,
        grafanaNodePort,
        loadgenEnabled: raw.loadgenEnabled ?? true,
    };
}

export function loadConfig(): StackConfig {
    const config = new pulumi.Config();
    return parseConfig({
        isMinikube: config.getBoolean("isMinikube"),
        minikubeIp: config.get("minikubeIp"),
        grafanaNodePort: config.getNumber("grafanaNodePort"),
        loadgenEnabled: config.getBoolean("loadgenEnabled"),
    });
}
