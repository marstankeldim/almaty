import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { decodeTerrarium } from '/Users/ayan/Documents/cmpsc/almaty/src/terrarium.js';

const ROOT='/Users/ayan/Documents/cmpsc/almaty';
const PRE = {
  'trans-ili-alatau': { station:[0.5,0.20], unitsPerMeter:0.05, vExag:1.35, heightFrac:0.82, viewDistFrac:0.34, segX:700, segZ:466 },
  'big-almaty-lake': { station:[0.586,0.600], focus:[0.586,0.760], camAboveM:95, lookLiftM:420, unitsPerMeter:0.1, vExag:1.0, segX:583, segZ:558 },
  'charyn-canyon': { station:[0.532,0.751], focus:[0.700,0.645], camAboveM:620, lookLiftM:-120, unitsPerMeter:0.1, vExag:1.15, deepen:1.9, segX:640, segZ:630 },
};

for (const [id,cfg] of Object.entries(PRE)) {
  const meta = JSON.parse(readFileSync(`${ROOT}/public/assets/dem/${id}.json`,'utf8'));
  const { data, info } = await sharp(`${ROOT}/public/assets/dem/${id}.png`).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const dem = decodeTerrarium(new Uint8Array(data), info.width, info.height);
  const mpp = meta.metersPerPixel, upm=cfg.unitsPerMeter, vE=cfg.vExag, deepen=cfg.deepen??1;
  const [uS,vS]=cfg.station;
  const spanX = info.width*mpp*upm, spanZ = info.height*mpp*upm;
  const elevStation = dem.sample(uS,vS);
  const sceneOf=(u,v)=>[(u-uS)*spanX, -(v-vS)*spanZ];
  const heightAtUv=(u,v)=>(dem.sample(u,v)-elevStation)*upm*vE;
  const height=(x,z)=>{ const u=Math.min(1,Math.max(0,uS+x/spanX)), v=Math.min(1,Math.max(0,vS-z/spanZ));
    let h=dem.sample(u,v)-elevStation; if(h<0)h*=deepen; return h*upm*vE; };
  let best={h:-Infinity,x:0,z:0};
  for(let iv=0;iv<=48;iv++){const v=(vS+0.04)+(1-(vS+0.04))*(iv/48);
    for(let iu=0;iu<=48;iu++){const u=0.12+0.76*(iu/48); const e=dem.sample(u,v);
      if(e>best.h)best={h:e,x:(u-uS)*spanX,z:-(v-vS)*spanZ};}}
  const peakY=(best.h-elevStation)*upm*vE;
  let stand,look;
  if(cfg.focus){ const [fu,fv]=cfg.focus; const [fx,fz]=sceneOf(fu,fv); const fy=heightAtUv(fu,fv);
    stand={x:0,y:(cfg.camAboveM??60)*upm*vE,z:0}; look={x:fx,y:fy+(cfg.lookLiftM??0)*upm*vE,z:fz};
  } else { const camY=peakY*(cfg.heightFrac??0.85); const vd=(cfg.viewDistFrac??0.32)*spanZ;
    stand={x:best.x*0.35,y:camY,z:best.z+vd}; look={x:best.x,y:peakY*0.92,z:best.z}; }

  // march the bottom-of-frame ray (fov 55 vertical, half 27.5deg) to first hit
  const fwd = {x:look.x-stand.x,y:look.y-stand.y,z:look.z-stand.z};
  const fl=Math.hypot(fwd.x,fwd.y,fwd.z); fwd.x/=fl;fwd.y/=fl;fwd.z/=fl;
  // right = fwd x up ; down-tilted ray = rotate fwd about right by -27.5deg
  const up={x:0,y:1,z:0};
  const right={x:fwd.z*1-0,y:0,z:-fwd.x}; // fwd cross up (0,1,0) => (fwd.z*1-fwd.y*0, fwd.z*0-fwd.x*1... ) do properly
  // proper: r = normalize(cross(fwd, up))
  const cx=fwd.y*up.z-fwd.z*up.y, cy=fwd.z*up.x-fwd.x*up.z, cz=fwd.x*up.y-fwd.y*up.x;
  const cl=Math.hypot(cx,cy,cz); const R={x:cx/cl,y:cy/cl,z:cz/cl};
  // camUp = cross(R, fwd)
  const U={x:R.y*fwd.z-R.z*fwd.y, y:R.z*fwd.x-R.x*fwd.z, z:R.x*fwd.y-R.y*fwd.x};
  const th=27.5*Math.PI/180;
  const march=(ray,label)=>{
    let d=0,prev=null,hit=null;
    for(d=0.2; d<spanZ*2; d*=1.01){
      const px=stand.x+ray.x*d, py=stand.y+ray.y*d, pz=stand.z+ray.z*d;
      const g=height(px,pz);
      if(py<g){ hit=d; break; }
    }
    // pixel footprint: 1080px vertical over 55deg
    const perPx = (55*Math.PI/180)/1080;
    let foot=null, inc=null;
    if(hit){
      const px=stand.x+ray.x*hit, pz=stand.z+ray.z*hit;
      const e=0.5;
      const gx=(height(px+e,pz)-height(px-e,pz))/(2*e), gz=(height(px,pz+e)-height(px,pz-e))/(2*e);
      let n={x:-gx,y:1,z:-gz}; const nl=Math.hypot(n.x,n.y,n.z); n={x:n.x/nl,y:n.y/nl,z:n.z/nl};
      const cosI=Math.abs(ray.x*n.x+ray.y*n.y+ray.z*n.z);
      inc=Math.acos(Math.min(1,cosI))*180/Math.PI;
      foot=(hit*perPx)/Math.max(0.02,cosI)/upm; // metres per screen pixel on the surface
    }
    console.log(`   ${label}: hit ${hit? (hit).toFixed(1)+'u = '+(hit/upm).toFixed(0)+'m':'none'}`
      + (foot?`, incidence ${inc.toFixed(0)}deg, surface m/px ${foot.toFixed(2)}`:''));
    return hit;
  };
  const rot=(ang)=>({x:fwd.x*Math.cos(ang)-U.x*Math.sin(ang), y:fwd.y*Math.cos(ang)-U.y*Math.sin(ang), z:fwd.z*Math.cos(ang)-U.z*Math.sin(ang)});
  console.log(`\n=== ${id} ===`);
  console.log(` dem ${info.width}x${info.height}px  mpp ${mpp.toFixed(2)}  spanX ${spanX.toFixed(0)}u spanZ ${spanZ.toFixed(0)}u  (1u=${(1/upm).toFixed(0)}m)`);
  console.log(` elevStation ${elevStation.toFixed(0)}m  peak ${best.h.toFixed(0)}m  peakY ${peakY.toFixed(1)}u`);
  console.log(` stand (${stand.x.toFixed(1)},${stand.y.toFixed(1)},${stand.z.toFixed(1)})  = ${(stand.y/upm/vE).toFixed(0)}m above station`);
  console.log(` look  (${look.x.toFixed(1)},${look.y.toFixed(1)},${look.z.toFixed(1)})  fwd pitch ${(Math.asin(fwd.y)*180/Math.PI).toFixed(1)}deg`);
  console.log(` quad size ${((spanX* (0)+ (0))||0).toFixed(0)}`);
  const dxq=(spanX)/info.width; // not used
  march(rot(th),'bottom-of-frame ray');
  march(rot(th*0.5),'quarter-down ray');
  march(fwd,'centre ray');
  // satellite texel size on screen at the near hit
  console.log(` satellite texel = ${mpp.toFixed(1)}m; mesh quad = ${( (spanX/cfg.segX)/upm ).toFixed(0)}m`);
  // entry anchor
  const entry={x:stand.x+(look.x-stand.x)*-0.1, y:stand.y+spanZ*0.11, z:stand.z+spanZ*0.13};
  console.log(` entryPos y ${entry.y.toFixed(0)}u = ${(entry.y/upm/vE).toFixed(0)}m above station; liftHeight ${Math.max(peakY*1.15,(spanZ)*0.2).toFixed(0)}u`);
}
