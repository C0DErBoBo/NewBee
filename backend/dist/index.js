"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = require("./app");
const env_1 = require("./config/env");
const client_1 = require("./database/client");
async function bootstrap() {
    await (0, client_1.migrate)();
    const app = (0, app_1.createApp)();
    app.listen(env_1.env.PORT, () => {
        // eslint-disable-next-line no-console
        console.log(`Backend 服务已启动，端口：${env_1.env.PORT}`);
    });
}
bootstrap().catch((error) => {
    // eslint-disable-next-line no-console
    console.error('服务启动失败', error);
    process.exit(1);
});
