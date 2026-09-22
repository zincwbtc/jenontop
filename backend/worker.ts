import {GET,POST} from './shop';
export default {async fetch(request:Request,env:any){
 const origin=request.headers.get('Origin')||'';const allowed=env.ALLOWED_ORIGIN;
 const headers={'Access-Control-Allow-Origin':origin===allowed?origin:'https://invalid.invalid','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization','Vary':'Origin','Cache-Control':'no-store'};
 if(!allowed||origin!==allowed)return Response.json({error:'Origin not allowed'},{status:403,headers});
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(!env.TEST_ACCESS_KEY||env.TEST_ACCESS_KEY.length<32||request.headers.get('Authorization')!=='Bearer '+env.TEST_ACCESS_KEY)return Response.json({error:'Invalid private test access key.'},{status:401,headers});
 if(new URL(request.url).pathname!=='/api/shop')return new Response('Not found',{status:404,headers});
 const response=request.method==='GET'?await GET(request):request.method==='POST'?await POST(request):new Response('Method not allowed',{status:405});
 const result=new Response(response.body,response);Object.entries(headers).forEach(([k,v])=>result.headers.set(k,v));return result;
}};
