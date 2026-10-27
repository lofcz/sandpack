import { AssetTransformer, ASSET_EXTENSIONS } from './index';

it.each([['mp3','audio/mpeg'],['mpeg','audio/mpeg'],['ogg','audio/ogg'],['m4a','audio/mp4'],['woff2','font/woff2']])('preserves binary %s bytes and emits the correct MIME type', async(extension,mime)=>{
 const bytes=Uint8Array.from([0,255,128,73,68,51,0,254]);
 const filepath=`/app/assets/clip.${extension}`;
 const transformer=new AssetTransformer();
 await transformer.init({fs:{boundContext:{fs:{promises:{readFile:async()=>bytes}}}}} as any);
 const result=await transformer.transform({module:{filepath,source:'corrupted UTF-8'}} as any,{});
 const module={exports:''};
 new Function('module',result.code)(module);
 expect(module.exports).toBe(`data:${mime};base64,${Buffer.from(bytes).toString('base64')}`);
 expect(ASSET_EXTENSIONS).toContain(extension);
});
