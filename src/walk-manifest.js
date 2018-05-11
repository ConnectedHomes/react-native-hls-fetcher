const m3u8 = require('m3u8-parser');
const syncRequest = require('sync-request');
const url = require('url');
const path = require('path');
const fs = require('fs');

const joinURI = function (absolute, relative) {
  const parse = url.parse(absolute);
  parse.pathname = path.join(parse.pathname, relative);
  return url.format(parse);
};


const isAbsolute = function (uri) {
  const parsed = url.parse(uri);
  if (parsed.protocol) {
    return true;
  }
  return false;
};

const mediaGroupPlaylists = function (mediaGroups) {
  const playlists = [];
  ['AUDIO', 'VIDEO', 'CLOSED-CAPTIONS', 'SUBTITLES'].forEach((type) => {
    const mediaGroupType = mediaGroups[type];
    if (mediaGroupType && !Object.keys(mediaGroupType).length) {
      return;
    }

    for (const group in mediaGroupType) {
      for (const item in mediaGroupType[group]) {
        const props = mediaGroupType[group][item];
        playlists.push(props);
      }
    }
  });
  return playlists;
};

const parseManifest = function (content) {
  const parser = new m3u8.Parser();
  parser.push(content);
  parser.end();
  return parser.manifest;
};

const parseKey = function (basedir, decrypt, resources, manifest, parent) {
  if (!manifest.parsed.segments[0] || !manifest.parsed.segments[0].key) {
    return {};
  }
  const key = manifest.parsed.segments[0].key;

  let keyUri = key.uri;
  if (!isAbsolute(keyUri)) {
    keyUri = joinURI(path.dirname(manifest.uri), keyUri);
  }

  // if we are not decrypting then we just download the key
  if (!decrypt) {
    // put keys in parent-dir/key-name.key
    key.file = basedir;
    if (parent) {
      key.file = path.dirname(parent.file);
    }
    key.file = path.join(key.file, path.basename(key.uri));

    manifest.content = new Buffer(manifest.content.toString().replace(
      key.uri,
      path.relative(path.dirname(manifest.file), key.file),
    ));
    key.uri = keyUri;
    resources.push(key);
    return key;
  }

  // get the aes key
  const keyContent = syncRequest('GET', keyUri).getBody();
  key.bytes = new Uint32Array([
    keyContent.readUInt32BE(0),
    keyContent.readUInt32BE(4),
    keyContent.readUInt32BE(8),
    keyContent.readUInt32BE(12),
  ]);

  // remove the key from the manifest
  manifest.content = new Buffer(manifest.content.toString().replace(
    new RegExp(`.*${key.uri}.*`),
    '',
  ));


  return key;
};

var walkPlaylist = function (decrypt, basedir, uri, parent, manifestIndex) {
  let resources = [];
  const manifest = {};
  manifest.uri = uri;
  manifest.file = path.join(basedir, path.basename(uri));
  resources.push(manifest);

  // if we are not the master playlist
  if (parent) {
    manifest.file = path.join(
      path.dirname(parent.file),
      `manifest${manifestIndex}`,
      path.basename(manifest.file),
    );
    // get the real uri of this playlist
    if (!isAbsolute(manifest.uri)) {
      manifest.uri = joinURI(path.dirname(parent.uri), manifest.uri);
    }
    // replace original uri in file with new file path
    parent.content = new Buffer(parent.content.toString().replace(uri, path.relative(path.dirname(parent.file), manifest.file)));
  }

  manifest.content = syncRequest('GET', manifest.uri).getBody();
  manifest.parsed = parseManifest(manifest.content);
  manifest.parsed.segments = manifest.parsed.segments || [];
  manifest.parsed.playlists = manifest.parsed.playlists || [];
  manifest.parsed.mediaGroups = manifest.parsed.mediaGroups || {};

  const playlists = manifest.parsed.playlists.concat(mediaGroupPlaylists(manifest.parsed.mediaGroups));
  const key = parseKey(basedir, decrypt, resources, manifest, parent);

  // SEGMENTS
  manifest.parsed.segments.forEach((s, i) => {
    if (!s.uri) {
      return;
    }
    // put segments in manifest-name/segment-name.ts
    s.file = path.join(path.dirname(manifest.file), path.basename(s.uri));
    if (!isAbsolute(s.uri)) {
      s.uri = joinURI(path.dirname(manifest.uri), s.uri);
    }
    if (key) {
      s.key = key;
      s.key.iv = s.key.iv || new Uint32Array([0, 0, 0, manifest.parsed.mediaSequence, i]);
    }
    manifest.content = new Buffer(manifest.content.toString().replace(s.uri, path.basename(s.uri)));
    resources.push(s);
  });

  // SUB Playlists
  playlists.forEach((p, z) => {
    if (!p.uri) {
      return;
    }
    resources = resources.concat(walkPlaylist(decrypt, basedir, p.uri, manifest, z));
  });

  return resources;
};

module.exports = walkPlaylist;
