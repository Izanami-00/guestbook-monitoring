import * as k8s from "@pulumi/kubernetes";
import * as k8stypes from "@pulumi/kubernetes/types/input";
import { StackConfig } from "./config";
import { Guestbook } from "./guestbook";
import { versions } from "./versions";

// Every 0.5s: load the page and read the guestbook (redis-replica). Every 5s: write a value (redis-leader).
// Writes go to a dedicated key so entries people add through the UI are left alone.
const LOAD_SCRIPT = `
i=0
while true; do
  curl -fsS --max-time 5 -o /dev/null http://frontend/ || echo "GET / failed"
  curl -fsS --max-time 5 -o /dev/null "http://frontend/guestbook.php?cmd=get&key=messages" || echo "read failed"
  i=$((i + 1))
  if [ $((i % 10)) -eq 0 ]; then
    curl -fsS --max-time 5 -o /dev/null "http://frontend/guestbook.php?cmd=set&key=loadgen&value=ping-$(date +%s)" || echo "write failed"
  fi
  sleep 0.5
done
`;

export function loadgenContainer(): k8stypes.core.v1.Container {
    return {
        name: "loadgen",
        image: versions.loadgenImage,
        command: ["/bin/sh", "-c"],
        args: [LOAD_SCRIPT],
        resources: {
            requests: { cpu: "10m", memory: "16Mi" },
            limits: { cpu: "200m", memory: "32Mi" },
        },
    };
}

export function shouldDeployLoadgen(cfg: StackConfig): boolean {
    return cfg.loadgenEnabled;
}

export function createLoadgen(cfg: StackConfig, guestbook: Guestbook): k8s.apps.v1.Deployment | undefined {
    if (!shouldDeployLoadgen(cfg)) {
        return undefined;
    }
    const labels = { app: "loadgen" };
    return new k8s.apps.v1.Deployment("loadgen", {
        metadata: { name: "loadgen", namespace: guestbook.namespace.metadata.name, labels },
        spec: {
            replicas: 1,
            selector: { matchLabels: labels },
            template: {
                metadata: { labels },
                spec: { containers: [loadgenContainer()] },
            },
        },
    }, { dependsOn: [guestbook.frontend] });
}
