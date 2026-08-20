// CommonJS on purpose: package.json sets "type": "module", and PostCSS config
// resolution is most reliable with an explicit .cjs here.
module.exports = {
  plugins: {
    "@pandacss/dev/postcss": {},
  },
};
