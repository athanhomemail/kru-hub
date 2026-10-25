import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({ plugins: [react(), tailwindcss()], optimizeDeps: { include: ['pdfjs-dist', 'motion/react', 'lucide-react', 'axios', 'socket.io-client'] }, server: { port: 5174, strictPort: true, proxy: { '/api': 'http://127.0.0.1:4001', '/socket.io': { target: 'http://127.0.0.1:4001', ws: true } } } });
