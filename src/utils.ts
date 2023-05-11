import { App, TAbstractFile, TFile } from "obsidian";
import { LinkMatch, getAllLinkMatchesInFile } from "./linkDetector";

const PASTED_IMAGE_PREFIX = "Pasted image ";
const imageRegex = /.*(jpe?g|png|gif|svg|bmp)/i;
const bannerRegex = /!\[\[(.*?)\]\]/i;
const imageExtensions: Set<string> = new Set(["jpeg", "jpg", "png", "gif", "svg", "bmp"]);

export const DEBUG = !(process.env.BUILD_ENV === "production");
if (DEBUG) console.log("DEBUG is enabled");

export function debugLog(...args: unknown[]) {
  if (DEBUG) {
    console.log(new Date().toISOString().slice(11, 23), ...args);
  }
}

export const blobToArrayBuffer = (blob: Blob) => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsArrayBuffer(blob);
  });
};

export function isMarkdownFile(file: TAbstractFile): boolean {
  if (file instanceof TFile) {
    if (file.extension === "md") {
      return true;
    }
  }
  return false;
}

export function isCanvasFile(file: TAbstractFile): boolean {
  if (file instanceof TFile) {
    if (file.extension === "canvas") {
      return true;
    }
  }
  return false;
}

export function isPastedImage(file: TAbstractFile): boolean {
  if (file instanceof TFile) {
    if (file.name.startsWith(PASTED_IMAGE_PREFIX)) {
      return true;
    }
  }
  return false;
}

export function isImage(extension: string): boolean {
  const types = ["jpeg", "png", "jpg", "svg", "gif", "eps"];
  if (types.indexOf(extension.toLowerCase())) {
    return true;
  }

  return false;
}

// find the first prefix difference of two paths
// e.g.:
//     "Resources/Untitled/Untitled 313/Untitled"
//     "Resources/Untitled1/Untitled 313/Untitled"
// result:
//     "Resources/Untitled"
//     "Resources/Untitled1"
export function stripPaths(src: string, dst: string): { nsrc: string; ndst: string } | undefined {
  if (src === dst) {
    return { nsrc: src, ndst: dst };
  }

  const srcParts = src.split("/");
  const dstParts = dst.split("/");

  if (srcParts.length !== dstParts.length) {
    return undefined;
  }

  for (let i = 0; i < srcParts.length; i++) {
    const srcPart = srcParts[i];
    const dstPart = dstParts[i];

    // find the first different part
    if (srcPart !== dstPart) {
      return {
        nsrc: srcParts.slice(0, i + 1).join("/"),
        ndst: dstParts.slice(0, i + 1).join("/"),
      };
    }
  }

  return { nsrc: "", ndst: "" };
}

export function testExcludeExtension(extension: string, pattern: string): boolean {
  if (!pattern || pattern === "") return false;
  return new RegExp(pattern).test(extension);
}

export async function getAttachmentsInVault(app: App, type: "all" | "links"): Promise<Record<string, Set<string>>> {
  let attachmentsRecord: Record<string, Set<string>> = {};

  // if (type === "links") {
  attachmentsRecord = await getAttachmentsInVaultByLinks(app);
  // } else {
  //   let allFiles = app.vault.getFiles();
  //   let attachments: TFile[] = [];

  //   for (let i = 0; i < allFiles.length; i++) {
  //     if (!["md", "canvas"].includes(allFiles[i].extension)) {
  //       continue;
  //     }
  //     if (type === "all") {
  //       attachments.push(allFiles[i]);
	// 			addToSet(attachmentsSet, allFiles[i].path);
  //     }
  //   }
  // }
  return attachmentsRecord;
}

// refer https://github.com/ozntel/oz-clear-unused-images-obsidian/blob/master/src/util.ts#LL48C21-L48C21
export async function getAttachmentsInVaultByLinks(app: App): Promise<Record<string, Set<string>>> {
  let attachmentsRecord: Record<string, Set<string>> = {};
  let resolvedLinks = app.metadataCache.resolvedLinks;
  if (resolvedLinks) {
    for (const [mdFile, links] of Object.entries(resolvedLinks)) {
      let attachemtsSet: Set<string> = new Set();
      for (const [filePath, nr] of Object.entries(resolvedLinks[mdFile])) {
        if (!(filePath as String).endsWith(".md") || !(filePath as String).endsWith(".canvas")) {
          addToSet(attachemtsSet, filePath);
        }
      }
      addToRecord(attachmentsRecord, mdFile, attachemtsSet);
    }
  }
  // Loop Files and Check Frontmatter/Canvas
  let allFiles = app.vault.getFiles();
  for (let i = 0; i < allFiles.length; i++) {
    let obsFile = allFiles[i];
    let attachmentsSet: Set<string> = new Set();
    // Check Frontmatter for md files and additional links that might be missed in resolved links
    if (obsFile.extension === "md") {
      // Frontmatter
      let fileCache = app.metadataCache.getFileCache(obsFile);
      if (fileCache === null) {
        continue;
      }
      if (fileCache.frontmatter) {
        let frontmatter = fileCache.frontmatter;
        for (let k of Object.keys(frontmatter)) {
          if (typeof frontmatter[k] === "string") {
            if (frontmatter[k].match(bannerRegex)) {
              let fileName = frontmatter[k].match(bannerRegex)[1];
              let file = app.metadataCache.getFirstLinkpathDest(fileName, obsFile.path);
              if (file) {
                addToSet(attachmentsSet, file.path);
              }
            } else if (pathIsAnImage(frontmatter[k])) {
              addToSet(attachmentsSet, frontmatter[k]);
            }
          }
        }
      }
      // Any Additional Link
      let linkMatches: LinkMatch[] = await getAllLinkMatchesInFile(obsFile, app);
      for (let linkMatch of linkMatches) {
        addToSet(attachmentsSet, linkMatch.linkText);
      }
    }
    // Check Canvas for links
    else if (obsFile.extension === "canvas") {
      let fileRead = await app.vault.cachedRead(obsFile);
      let canvasData = JSON.parse(fileRead);
      // debugLog("canvasData", canvasData);
      if (canvasData.nodes && canvasData.nodes.length > 0) {
        for (const node of canvasData.nodes) {
          // node.type: 'text' | 'file'
          if (node.type === "file") {
            addToSet(attachmentsSet, node.file);
          } else if (node.type == "text") {
            let linkMatches: LinkMatch[] = await getAllLinkMatchesInFile(obsFile, app, node.text);
            for (let linkMatch of linkMatches) {
              addToSet(attachmentsSet, linkMatch.linkText);
            }
          }
        }
      }
    }
    addToRecord(attachmentsRecord, obsFile.path, attachmentsSet);
  }
  return attachmentsRecord;
}

const addToRecord = (record: Record<string, Set<string>>, key: string, value: Set<string>) => {
  if (!record[key]) {
    record[key] = value
  }
  const valueSet = record[key];
  for (const val in value) {
    addToSet(valueSet, val);
  }

  record[key] = valueSet
}

const addToSet = (setObj: Set<string>, value: string) => {
  if (!setObj.has(value)) {
    setObj.add(value);
  }
};

const pathIsAnImage = (path: string) => {
  return path.match(imageRegex);
};
