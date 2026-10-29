// Every chart version and image tag deployed by this program is pinned here. Resolved 2026-10-28.
export const versions = {
    kpsChart: "92.14.1",
    blackboxChart: "11.20.2",
    // Upstream image is amd64-only and untagged; pin by digest so the deploy is reproducible.
    frontendImage: "pulumi/guestbook-php-redis@sha256:f21cbff35c0bad29d0c480f741e19919fb135d7c7941b8b5fc7240503d0a1c4f",
    redisImage: "redis:8.10.3",
    apacheExporterImage: "quay.io/lusitaniae/apache-exporter:v1.1.1",
    redisExporterImage: "oliver006/redis_exporter:v1.94.0",
    loadgenImage: "curlimages/curl:8.23.0",
};
