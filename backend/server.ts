import {env} from 'cloudflare:workers';
import {catalog} from './catalog';
export const config=()=>env as unknown as Record<string,string>;
export function db(){if(!env.DB)throw new Error('Shop temporarily unavailable. Please try again.');return env.DB;}
export async function seed(){await db().batch(catalog.map(p=>db().prepare('INSERT OR IGNORE INTO products (id,name,game,rarity,price,stock,image,sample,active) VALUES (?,?,?,?,?,?,?,?,?)').bind(p.id,p.name,p.game,p.rarity,p.price,p.stock,p.image,p.sample,p.active)));}
export const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store'}});
export function sameOrigin(r:Request){const o=r.headers.get('origin');if(o!==config().ALLOWED_ORIGIN)throw new Error('Invalid request origin.');}
export function admin(r:Request){const key=config().TEST_ACCESS_KEY;if(!key||key.length<32||r.headers.get('authorization')!==`Bearer ${key}`)throw new Error('Invalid test access key.');}
export function validateWebhook(value:string){if(!value)return '';const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||!['discord.com','discordapp.com'].includes(u.hostname)||!u.pathname.startsWith('/api/webhooks/'))throw new Error('Use a Discord HTTPS webhook URL.');return u.toString();}
