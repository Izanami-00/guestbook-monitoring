import * as pulumi from "@pulumi/pulumi";
import { createAlerts } from "./alerts";
import { StackConfig } from "./config";
import { createDashboards } from "./dashboards";
import { createGuestbook } from "./guestbook";
import { createLoadgen } from "./loadgen";
import { createMonitoring, MONITORING_NAMESPACE, PROMETHEUS_SERVICE } from "./monitoring";
import { createScrapeConfigs } from "./scrape";

export interface StackOutputs {
    frontendUrl: pulumi.Output<string>;
    grafanaUrl: pulumi.Output<string>;
    grafanaAccessCommand: string;
    grafanaAdminUser: string;
    grafanaAdminPassword: pulumi.Output<string>;
    prometheusAccessCommand: string;
}

export function createStack(cfg: StackConfig): StackOutputs {
    const guestbook = createGuestbook(cfg);
    const monitoring = createMonitoring(cfg);

    createScrapeConfigs(monitoring);
    createAlerts(monitoring.kps);
    createDashboards(monitoring.kps);
    createLoadgen(cfg, guestbook);

    return {
        frontendUrl: guestbook.frontendUrl,
        grafanaUrl: monitoring.grafanaUrl,
        grafanaAccessCommand: monitoring.grafanaAccessCommand,
        grafanaAdminUser: monitoring.adminUser,
        grafanaAdminPassword: monitoring.adminPassword,
        prometheusAccessCommand: `kubectl -n ${MONITORING_NAMESPACE} port-forward svc/${PROMETHEUS_SERVICE} 9090`,
    };
}
