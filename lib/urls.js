'use strict';

const YOUTUBE_RE = /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch(\?.*)?|shorts\/|playlist\?|embed\/|live\/)|youtu\.be\/|music\.youtube\.com\/)/i;
const INSTAGRAM_RE = /^(https?:\/\/)?(www\.)?instagram\.com\/(p\/|reel\/|reels\/|tv\/|stories\/)/i;
const INSTAGRAM_ANY_RE = /^(https?:\/\/)?(www\.)?instagram\.com\//i;

function normalizeUrl(str) {
  return (str || '').trim().replace(/[)\]},.;]+$/g, '');
}

function getMediaPlatform(url) {
  const u = normalizeUrl(url);
  if (!u) return null;
  if (YOUTUBE_RE.test(u) || /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/i.test(u)) {
    return 'youtube';
  }
  if (INSTAGRAM_ANY_RE.test(u) || /^(https?:\/\/)?(www\.)?instagr\.am\//i.test(u)) {
    return 'instagram';
  }
  return null;
}

function isSupportedMediaUrl(url) {
  return !!getMediaPlatform(url);
}

function isYouTubeUrl(url) {
  return getMediaPlatform(url) === 'youtube';
}

function isInstagramUrl(url) {
  return getMediaPlatform(url) === 'instagram';
}

function getInstagramContentKind(url) {
  const u = normalizeUrl(url).toLowerCase();
  if (u.includes('/stories/')) return 'story';
  if (u.includes('/reel/') || u.includes('/reels/')) return 'reel';
  if (u.includes('/p/') || u.includes('/tv/')) return 'post';
  return 'post';
}

function extractMediaUrls(text) {
  const found = new Set();
  const raw = text || '';
  const re = /https?:\/\/[^\s<>"']+/gi;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const cleaned = normalizeUrl(m[0]);
    if (isSupportedMediaUrl(cleaned)) found.add(cleaned);
  }
  raw.split(/\s+/).filter(Boolean).forEach(part => {
    const cleaned = normalizeUrl(part);
    if (isSupportedMediaUrl(cleaned)) found.add(cleaned);
  });
  return [...found];
}

module.exports = {
  normalizeUrl,
  getMediaPlatform,
  isSupportedMediaUrl,
  isYouTubeUrl,
  isInstagramUrl,
  getInstagramContentKind,
  extractMediaUrls,
};
