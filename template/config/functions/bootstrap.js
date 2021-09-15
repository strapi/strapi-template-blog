"use strict";

const fs = require("fs");
const mime = require("mime-types");
const set = require("lodash.set");

const {
  categories,
  homepage,
  writers,
  articles,
  global,
} = require("../../data/data.json");

async function isFirstRun() {
  const pluginStore = strapi.store({
    environment: strapi.config.environment,
    type: "type",
    name: "setup",
  });
  const initHasRun = await pluginStore.get({ key: "initHasRun" });
  await pluginStore.set({ key: "initHasRun", value: true });
  return !initHasRun;
}

/**
 *
 * @param {array} newPermissions permissions to update
 */
async function setPublicPermissions(newPermissions) {
  // Find the ID of the public role
  const publicRole = await strapi
    .query("plugin::users-permissions.role")
    .findOne({ type: "public" });

  // List all available permissions
  const publicPermissions = await strapi
    .query("plugin::users-permissions.permission")
    .findMany({
      type: ["users-permissions", "application"],
      role: publicRole.id,
    });

  // Update permission to match new config
  const controllersToUpdate = Object.keys(newPermissions);
  const updatePromises = publicPermissions
    .filter((permission) => {
      // Only update permissions included in newConfig
      if (!controllersToUpdate.includes(permission.controller)) {
        return false;
      }
      if (!newPermissions[permission.controller].includes(permission.action)) {
        return false;
      }
      return true;
    })
    .map((permission) => {
      // Enable the selected permissions
      return strapi.query("plugin::users-permissions.permission").update({
        where: {
          id: permission.id,
        },
        data: {
          enabled: true,
        },
      });
    });

  await Promise.all(updatePromises);
}

function getFileSizeInBytes(filePath) {
  const stats = fs.statSync(filePath);
  const fileSizeInBytes = stats["size"];
  return fileSizeInBytes;
}

function getFileData(fileName) {
  const filePath = `./data/uploads/${fileName}`;
  // Parse the file metadata
  const size = getFileSizeInBytes(filePath);
  const ext = fileName.split(".").pop();
  const mimeType = mime.lookup(ext);

  return {
    path: filePath,
    name: fileName,
    size,
    type: mimeType,
  };
}

// Create an entry and attach files if there are any
async function createEntry({ model, entry, files }) {
  try {
    if (files) {
      for (const [key, file] of Object.entries(files)) {
        // Get file name without the extension
        const [fileName] = file.name.split(".");
        // Upload each individual file
        const uploadedFile = await strapi
          .plugin("upload")
          .service("upload")
          .upload({
            files: file,
            data: {
              fileInfo: {
                alternativeText: fileName,
                caption: fileName,
                name: fileName,
              },
            },
          });

        // Attach each file to its entry
        set(entry, key, { id: uploadedFile[0].id });
      }
    }

    await strapi.entityService.create(`api::${model}.${model}`, {
      data: entry,
    });
  } catch (e) {
    console.log(`${model} failed`, `error:`, e);
  }
}

async function importCategories() {
  return Promise.all(
    categories.map((category) => {
      return createEntry({ model: "category", entry: category });
    })
  );
}

async function importWriters() {
  return Promise.all(
    writers.map(async (writer) => {
      const files = {
        picture: getFileData(`${writer.email}.jpg`),
      };

      return createEntry({
        model: "writer",
        entry: writer,
        files,
      });
    })
  );
}

async function importArticles() {
  return Promise.all(
    articles.map((article) => {
      const files = {
        image: getFileData(`${article.slug}.jpg`),
      };

      return createEntry({
        model: "article",
        entry: article,
        files,
      });
    })
  );
}

async function importGlobal() {
  const files = {
    favicon: getFileData("favicon.png"),
    "defaultSeo.shareImage": getFileData("default-image.png"),
  };

  return createEntry({
    model: "global",
    entry: global,
    files,
  });
}

async function importHomepage() {
  const files = {
    "seo.shareImage": getFileData("default-image.png"),
  };

  return createEntry({
    model: "homepage",
    entry: homepage,
    files,
  });
}

async function importSeedData() {
  // Allow read of application content types
  await setPublicPermissions({
    global: ["find"],
    homepage: ["find"],
    article: ["find", "findone"],
    category: ["find", "findone"],
    writer: ["find", "findone"],
  });

  // Create all entries
  await importArticles();
  await importCategories();
  await importHomepage();
  await importWriters();
  await importGlobal();
}

module.exports = async () => {
  const shouldImportSeedData = await isFirstRun();
  if (shouldImportSeedData) {
    try {
      console.log("Setting up the template...");
      await importSeedData();
      console.log("Ready to go");
    } catch (error) {
      console.log("Could not import seed data");
      console.error(error);
    }
  }
};
