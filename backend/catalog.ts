export type Product={id:string;name:string;game:string;rarity:string;price:number;stock:number;image:string;sample:number;active:number};
export const catalog:Product[]=[
{id:'harvester',name:'Harvester',game:'Murder Mystery 2',rarity:'Ancient',price:1899,stock:12,image:'/items/harvester.png',sample:1,active:1},
{id:'frost-dragon',name:'Frost Dragon',game:'Adopt Me!',rarity:'Legendary',price:3499,stock:8,image:'/items/frost-dragon.png',sample:1,active:1},
{id:'kitsune',name:'Kitsune',game:'Blox Fruits',rarity:'Mythical',price:1499,stock:24,image:'/items/kitsune.png',sample:1,active:1},
{id:'icebreaker',name:'Icebreaker',game:'Murder Mystery 2',rarity:'Ancient',price:799,stock:18,image:'/items/icebreaker.png',sample:1,active:1},
{id:'shadow-dragon',name:'Shadow Dragon',game:'Adopt Me!',rarity:'Legendary',price:6499,stock:4,image:'/items/shadow-dragon.png',sample:1,active:1},
{id:'chroma-lightbringer',name:'Chroma Lightbringer',game:'Murder Mystery 2',rarity:'Chroma',price:1299,stock:10,image:'/items/chroma-lightbringer.png',sample:1,active:1},
{id:'dragon',name:'Dragon',game:'Blox Fruits',rarity:'Mythical',price:2499,stock:9,image:'/items/dragon.png',sample:1,active:1},
{id:'elderwood-scythe',name:'Elderwood Scythe',game:'Murder Mystery 2',rarity:'Ancient',price:999,stock:15,image:'/items/elderwood-scythe.png',sample:1,active:1}];
export const money=(v:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(v/100);
