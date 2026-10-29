// Copyright 2016-2025, Pulumi Corporation.  All rights reserved.
// Extended with Prometheus + Grafana monitoring.

import { loadConfig } from "./src/config";
import { createStack } from "./src/stack";

const outputs = createStack(loadConfig());

export const frontendUrl = outputs.frontendUrl;
export const grafanaUrl = outputs.grafanaUrl;
export const grafanaAccessCommand = outputs.grafanaAccessCommand;
export const grafanaAdminUser = outputs.grafanaAdminUser;
export const grafanaAdminPassword = outputs.grafanaAdminPassword;
export const prometheusAccessCommand = outputs.prometheusAccessCommand;
