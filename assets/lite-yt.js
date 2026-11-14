/* Lite YouTube: links work without JS; with JS, a click swaps the thumbnail for a privacy-enhanced player. */
document.addEventListener('click', function (e) {
  var a = e.target.closest('a.yt[data-id]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  var f = document.createElement('iframe');
  f.src = 'https://www.youtube-nocookie.com/embed/' + a.dataset.id + '?autoplay=1&rel=0';
  f.title = a.getAttribute('aria-label') || 'YouTube video';
  f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
  f.allowFullscreen = true;
  f.className = 'yt-frame';
  a.replaceWith(f);
});
