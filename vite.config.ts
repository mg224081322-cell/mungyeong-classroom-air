import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { homedir } from 'node:os';
import { join } from 'node:path';
import air from './api/air.mjs';
import device from './api/device.mjs';
import logs from './api/logs.mjs';
import teacherUnlock from './api/teacher-unlock.mjs';
import { classroomPreview } from './server/classroom-preview.mjs';

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), {
    name: 'classroom-local-functions',
    transformIndexHtml(html) {
      if (process.env.VERCEL !== '1') return html;
      const host = (process.env.VERCEL_ENV === 'production' ? process.env.VERCEL_PROJECT_PRODUCTION_URL : process.env.VERCEL_URL) || process.env.VERCEL_URL;
      if (!host || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(host)) return html.replace(/^\s*<meta property="og:image[^\n]*\n/gm, '\n');
      return html.replace('https://mungyeong-classroom-air.baze.cloud/og.png', `https://${host}/og.png`);
    },
    configureServer(server) {
      const env = loadEnv(mode, process.cwd(), '');
      for (const name of ['AIRKOREA_SERVICE_KEY', 'AIRKOREA_STATION_NAME', 'TEACHER_PIN']) {
        if (!process.env[name] && env[name]) process.env[name] = env[name];
      }
      // The preview process may already be running when a secret is first saved.
      if (!process.env.TEACHER_PIN || !process.env.AIRKOREA_SERVICE_KEY) {
        try { process.loadEnvFile(join(homedir(), '.config/factchat/project.env')); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
      const classroom = classroomPreview(process.cwd());
      server.httpServer?.once('close', classroom.close);
      const handlers = new Map([['/api/air', air], ['/api/logs', logs], ['/api/device', device], ['/api/teacher-unlock', teacherUnlock]]);
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith('/api/classrooms/')) { void classroom.handle(req, res).catch(next); return; }
        const handler = handlers.get((req.url ?? '').split('?')[0]);
        if (!handler) return next();
        void handler(req, res).catch(next);
      });
    },
  }],
  server: { host: '0.0.0.0', port: 5173, allowedHosts: true, fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.wrangler/**', '**/server/**'] } },
}));
