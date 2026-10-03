import { defineConfig } from 'vite';
import * as fs from 'fs';
import * as path from 'path';
import * as multiparty from 'multiparty';
import serveStatic from 'serve-static';
import { spawn, ChildProcess } from 'child_process';

let pythonTrackerProcess: ChildProcess | null = null;

function localAssetsPlugin() {
  return {
    name: 'local-assets-plugin',
    configureServer(server: any) {
      // 1. Middleware para servir los archivos de la carpeta "user"
      server.middlewares.use('/user', serveStatic(path.join(process.cwd(), 'user')));

      // 2. Middleware de la API local
      server.middlewares.use(async (req: any, res: any, next: any) => {
        // Controladores para arrancar/detener el script Python en vivo
        if (req.url === '/api/tracker/start-live' && req.method === 'POST') {
          if (pythonTrackerProcess) {
            pythonTrackerProcess.kill();
          }
          
          const pythonExe = process.platform === 'win32' && fs.existsSync('./tracker/python_portable/python.exe')
            ? './tracker/python_portable/python.exe' 
            : 'python';

          console.log('[API] Iniciando Motor Python (Live OSC)...');
          pythonTrackerProcess = spawn(pythonExe, ['tracker/main.py', '--engine', 'mediapipe', '--live', '--osc-port', '39539'], {
             cwd: process.cwd(),
             stdio: 'inherit'
          });
          
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: true }));
          return;
        }

        if (req.url === '/api/tracker/stop' && req.method === 'POST') {
          if (pythonTrackerProcess) {
            pythonTrackerProcess.kill();
            pythonTrackerProcess = null;
            console.log('[API] Motor Python detenido.');
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: true }));
          return;
        }
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

      // 3. Servidor de WebSockets (OSC/VMC Bridge)
      import('ws').then(({ WebSocketServer }) => {
        import('node-osc').then(({ Server: OSCServer }) => {
          const wss = new WebSocketServer({ noServer: true });
          
          server.httpServer.on('upgrade', (request: any, socket: any, head: any) => {
            if (request.url === '/vmc') {
              wss.handleUpgrade(request, socket, head, (ws: any) => {
                wss.emit('connection', ws, request);
              });
            }
          });

          let oscServer: any = null;

          wss.on('connection', (ws: any) => {
            ws.on('message', (message: string) => {
              const data = JSON.parse(message);
              
              if (data.type === 'start') {
                const port = data.port || 39539;
                if (oscServer) oscServer.close();
                
                try {
                  oscServer = new OSCServer(port, '0.0.0.0', () => {
                    ws.send(JSON.stringify({ type: 'status', status: 'listening', port }));
                    console.log(`[VMC] Escuchando OSC en puerto ${port}`);
                  });
                  
                  oscServer.on('message', (msg: any) => {
                    // msg es un array: [address, ...args]
                    // Filtramos para reducir ruido de la consola si es necesario, pero lo enviamos al cliente
                    ws.send(JSON.stringify({ type: 'osc', message: msg }));
                  });
                } catch (e: any) {
                  ws.send(JSON.stringify({ type: 'error', message: e.message }));
                }
                
              } else if (data.type === 'stop') {
                if (oscServer) {
                  oscServer.close();
                  oscServer = null;
                }
                ws.send(JSON.stringify({ type: 'status', status: 'stopped' }));
                console.log(`[VMC] Servidor OSC detenido`);
              }
            });
            
            ws.on('close', () => {
              if (oscServer) {
                oscServer.close();
                oscServer = null;
              }
            });
          });
        });
      });
    }
  };
}

export default defineConfig({
  plugins: [localAssetsPlugin()]
});
