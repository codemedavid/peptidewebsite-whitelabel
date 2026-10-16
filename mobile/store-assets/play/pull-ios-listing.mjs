// Pulls the approved iOS listing copy + screenshots from App Store Connect so
// the Play listing stays word-for-word consistent. Needs the ASC API key.
import crypto from "node:crypto"; import fs from "node:fs";
const KEY_ID="H655D7F45J", ISSUER="c3473b07-3f04-4634-8fd3-50d960e8afd8", APP="6818043518";
const KEY=fs.readFileSync(`${process.env.HOME}/.appstoreconnect/private_keys/AuthKey_${KEY_ID}.p8`,"utf8");
const b64=o=>Buffer.from(JSON.stringify(o)).toString("base64url");
function jwt(){const h=b64({alg:"ES256",kid:KEY_ID,typ:"JWT"});const now=Math.floor(Date.now()/1000);
 const p=b64({iss:ISSUER,iat:now,exp:now+1100,aud:"appstoreconnect-v1"});
 return `${h}.${p}.${crypto.sign("sha256",Buffer.from(h+"."+p),{key:KEY,dsaEncoding:"ieee-p1363"}).toString("base64url")}`;}
async function asc(path){const r=await fetch("https://api.appstoreconnect.apple.com"+path,{headers:{Authorization:"Bearer "+jwt()}});
 if(!r.ok) throw new Error(r.status+" "+(await r.text()).slice(0,500)); return r.json();}
const ver=(await asc(`/v1/apps/${APP}/appStoreVersions?limit=1`)).data[0];
const loc=(await asc(`/v1/appStoreVersions/${ver.id}/appStoreVersionLocalizations`)).data[0];
fs.writeFileSync("raw/ios-listing.json",JSON.stringify(loc.attributes,null,2));
let i=0;
for(const s of (await asc(`/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets`)).data)
 for(const sh of (await asc(`/v1/appScreenshotSets/${s.id}/appScreenshots`)).data){const a=sh.attributes.imageAsset;if(!a)continue;i++;
  const url=a.templateUrl.replace("{w}",a.width).replace("{h}",a.height).replace("{f}","png");
  fs.writeFileSync(`raw/ios-shot-${i}.png`,Buffer.from(await (await fetch(url)).arrayBuffer()));}
console.log("pulled",i,"screenshots");
