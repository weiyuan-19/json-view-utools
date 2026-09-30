const fs = require("node:fs");

window.jsonView = {
  readFile(filePath) {
    return fs.readFileSync(filePath, "utf8");
  },
};
