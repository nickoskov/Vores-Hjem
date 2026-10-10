/* Paa en computer kan App Store-linket ikke bruges: Mac'ens App Store-program viser ikke iPhone-apps
   ("Kan ikke oprette forbindelse til App Store"). Saa sender butiksknapperne til download-siden, hvor QR-koden
   kan scannes med telefonen, og paa download-siden selv peges der paa QR-koden. Telefoner og tablets roeres ikke.
   Google Play-knapperne goer det samme paa en computer (Nicko 10. okt. 2026), saa begge knapper viser QR-koden. */
(function () {
  var mobil = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints || 0) > 1;
  function computer() { return !mobil && window.matchMedia && window.matchMedia('(min-width:820px)').matches; }
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href*="apps.apple.com"], a[href*="/hent/appstore"], a[href*="play.google.com"], a[href*="/hent/googleplay"]') : null;
    if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || !computer()) return;
    e.preventDefault();
    var qr = document.querySelector('.qr');
    if (qr && window.getComputedStyle(qr).display !== 'none') {
      qr.scrollIntoView({ behavior: 'smooth', block: 'center' });
      qr.classList.remove('qr-puls'); void qr.offsetWidth; qr.classList.add('qr-puls');
    } else {
      window.location.href = 'https://download.unserzuhauseapp.de/';
    }
  }, false);
})();
