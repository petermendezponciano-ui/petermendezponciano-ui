# Guía de instalación — Ferretería IA

Paso a paso para que la web funcione en tu computadora.

## 1. Crear la base de datos (Supabase) — gratis

1. Entra a https://supabase.com → **Sign in** (con Google o correo).
2. Crea un proyecto nuevo: **New project** → ponle nombre (ej. `ferreteria`), contraseña de BD (guárdala) y región cercana a ti → **Create**.
3. Espera a que se cree (~2 min). Luego:
   - En el menú izquierdo: **SQL Editor** → pega todo el contenido de `supabase/schema.sql` → botón **Run**. Esto crea las tablas (productos, proveedores, modelos, historial).
   - En **Authentication → Providers**, verifica que **Email** esté activado.
   - En **Authentication → Users**: botón **Add user** → crea tu usuario (tu correo + una contraseña fuerte). Ese será tu único acceso.
4. En **Project Settings → API** copia dos valores:
   - `Project URL`
   - `anon public key`

## 2. Crear la clave de IA (Google Gemini) — gratis

1. Entra a https://aistudio.google.com/apikey → inicia sesión con tu cuenta de Google.
2. Botón **Create API key** → cópiala.

## 3. Conectar todo en el proyecto

1. En la carpeta `web`, copia el archivo `.env.example` a `.env.local`.
2. Pégalo con tus valores:

```
NEXT_PUBLIC_SUPABASE_URL=https://tuproyecto.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu_clave_anon
GEMINI_API_KEY=tu_clave_gemini
```

## 4. Arrancar la web

En la carpeta `web`, ejecuta:

```
npm run dev
```

Abre `http://localhost:3000` en tu navegador → te pedirá el login → entra con el usuario que creaste en Supabase.

Verás el panel con Inicio, Productos, Proveedores y Chat IA (el chat se habilita en la Fase 3).

## Importante

- Los archivos `.env.local` y las claves **nunca se comparten ni se suben a git**.
- Solo tú tienes acceso: sin tu correo+contraseña, nadie entra a la base de datos (está protegida con Row Level Security).

---

# Subir la web a internet — gratis (Vercel)

Con esto la web deja de estar solo en tu computadora y queda **pública en internet**,
accesible desde cualquier celular con cualquier red (no solo tu WiFi). Todo el
proceso es gratis (plan gratuito de Vercel y GitHub).

## 5. Crear cuentas gratuitas

1. **GitHub** (guarda tu código): entra a https://github.com → **Sign up** → crea
   tu usuario con tu correo. Confirma el correo que te llegue.
2. **Vercel** (aloja la web): entra a https://vercel.com → **Sign up** → elige
   **"Continue with GitHub"** y autoriza el acceso.

## 6. Subir el proyecto a GitHub

En la carpeta `web`, abre una terminal y ejecuta (uno por uno):

```
git add .
git commit -m "Versión inicial de Ferretería IA"
```

- En https://github.com → botón **New repository** → ponle nombre (ej. `ferreteria-ia`) →
  **Create repository** (deja todo como está, no marques nada).
- Copia las 3 líneas que te muestra GitHub en la sección **"…or push an existing
  repository from the command line"** y pégalas en la terminal de tu carpeta `web`
  (son los comandos que empiezan con `git remote add origin ...` y luego
  `git branch -M main` y `git push -u origin main`).

> Tus claves **NO** se suben: el archivo `.env.local` y `dev.log` están excluidos
> automáticamente (`.gitignore`).

## 7. Publicar en Vercel

1. Entra a https://vercel.com → **Add New…** → **Project**.
2. Busca tu repositorio `ferreteria-ia` → **Import**.
3. Vercel detecta Next.js solo. Antes de dar **Deploy**, en **Environment Variables**
   agrega **todas** las que tienes en tu `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `GEMINI_API_KEY`
   - `BACKUP_API_KEY`, `BACKUP_BASE_URL`, `BACKUP_MODEL` (si usas respaldo)
   - `BACKUP2_API_KEY`, `BACKUP2_MODEL`, `BACKUP2_BASE_URL` (si usas segundo respaldo)
   - `VISION_MODEL` (si la usas)
4. Botón **Deploy**. En ~2 minutos te muestra una URL pública tipo:
   `https://ferreteria-ia.vercel.app` — esa es tu web en internet.

## 8. Probar desde cualquier internet

1. Abre la URL pública desde el celular **con los datos móviles (sin WiFi)**.
2. Entra con tu correo y contraseña de Supabase.
3. Prueba: Productos, Catálogo (Imprimir / Guardar PDF) y Chat IA.

## Notas importantes para el hosting gratuito

- **Cada cambio futuro**: vuelve a `git add .` → `git commit` → `git push`.
  Vercel se actualiza solo.
- **Catálogo**: en Vercel el PDF se genera con el botón "Imprimir / Guardar PDF"
  del navegador (funciona en el celular). No usa Puppeteer (no disponible en
  hosting gratuito).
- **IA**: Gemini gratis tiene un límite diario (~20 mensajes). Si se agota, el
  chat usa los respaldos configurados o pide esperar.
- **Dominio propio** (opcional, costo aparte): Vercel permite conectar un dominio
  comprado (ej. `tuferreteria.com`).