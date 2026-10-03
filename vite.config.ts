import { defineConfig } from 'vite';
import * as fs from 'fs';
import * as path from 'path';
import * as multiparty from 'multiparty';
import serveStatic from 'serve-static';

function localAssetsPlugin() {
  return {
    name: 'local-assets-plugin',
    configureServer(server: any) {
      // 1. Middleware para servir los archivos de la carpeta "user"
      server.middlewares.use('/user', serveStatic(path.join(process.cwd(), 'user')));

      // 2. Middleware de la API local
      server.middlewares.use(async (req: any, res: any, next: any) => {
        if (req.url === '/api/library' && req.method === 'GET') {
          const getFiles = (dir: string) => {
            const fullPath = path.join(process.cwd(), dir);
            if (!fs.existsSync(fullPath)) return [];
            return fs.readdirSync(fullPath).filter(f => !fs.statSync(path.join(fullPath, f)).isDirectory());
          };

          const data = {
            models: [
              ...getFiles('public/assets/models').map(f => ({ path: `/assets/models/${f}`, name: f, isUser: false })),
              ...getFiles('user/models').map(f => ({ path: `/user/models/${f}`, name: f, isUser: true }))
            ],
            animations: [
              ...getFiles('public/assets/animations').map(f => ({ path: `/assets/animations/${f}`, name: f, isUser: false })),
              ...getFiles('user/animations').map(f => ({ path: `/user/animations/${f}`, name: f, isUser: true }))
            ],
            poses: [
              ...getFiles('public/assets/poses').map(f => ({ path: `/assets/poses/${f}`, name: f, isUser: false })),
              ...getFiles('user/poses').map(f => ({ path: `/user/poses/${f}`, name: f, isUser: true }))
            ]
          };

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(data));
          return;
        }

        if (req.url === '/api/upload' && req.method === 'POST') {
          const form = new multiparty.Form();
          form.parse(req, (err: any, fields: any, files: any) => {
            if (err) {
              res.statusCode = 500;
              res.end('Error parsing upload');
              return;
            }

            const category = fields.category[0]; // 'models', 'animations', 'poses'
            const file = files.file[0];
            
            const targetDir = path.join(process.cwd(), 'user', category);
            if (!fs.existsSync(targetDir)) {
              fs.mkdirSync(targetDir, { recursive: true });
            }

            const targetPath = path.join(targetDir, file.originalFilename);
            fs.copyFileSync(file.path, targetPath);
            fs.unlinkSync(file.path); // limpiar temp

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true, path: `/user/${category}/${file.originalFilename}` }));
          });
          return;
        }

        next();
      });
    }
  };
}

export default defineConfig({
  plugins: [localAssetsPlugin()]
});
