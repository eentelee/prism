import { createApp } from './app.mjs';
import { createStore } from './store/index.mjs';

const port = Number(process.env.PORT) || 8787;
const host = process.env.HOST || '0.0.0.0';

const store = createStore(process.env);
const app = createApp({ store });

app.listen(port, host, () => {
  console.log(`Daily API listening at http://${host}:${port}`);
});
