import * as assert from "assert";
import { parseConfig } from "../src/config";

describe("config", () => {
    it("applies defaults", () => assert.deepStrictEqual(parseConfig({}),
        { isMinikube: false, minikubeIp: undefined, grafanaNodePort: 30300, loadgenEnabled: true }));

    it("respects overrides", () => assert.strictEqual(parseConfig({ isMinikube: true }).isMinikube, true));

    it("rejects nodePort outside 30000-32767", () => assert.throws(() => parseConfig({ grafanaNodePort: 80 })));
});
