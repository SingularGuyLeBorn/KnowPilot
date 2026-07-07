import { loadRootEnv, getAppConfig } from "../infra/config.js";
import { yuqueListRepos, yuqueListDocs, yuqueGetDocV2 } from "../infra/yuqueClient.js";

loadRootEnv();
const config = getAppConfig();
const token = config.integrations.yuque.ctoken;
console.log("Yuque ctoken prefix:", token?.slice(0, 6));

const repos = (await yuqueListRepos(token || "")) as Array<{ namespace: string }>;
console.log("repos:", repos.length, repos[0]?.namespace);

if (repos[0]) {
  const docs = (await yuqueListDocs(repos[0].namespace, token || "")) as Array<{ slug: string }>;
  console.log("docs:", docs.length, docs[0]?.slug);
  if (docs[0]) {
    const doc = (await yuqueGetDocV2(repos[0].namespace, docs[0].slug, token || "")) as { title: string; body?: string };
    console.log("doc:", doc.title, "body_len:", doc.body?.length);
  }
}
