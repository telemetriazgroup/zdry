export function silenceVideo(el) {
  if (!el) return;
  el.muted = true;
  el.volume = 0;
}

export function videoSilenceProps() {
  return {
    muted: true,
    playsInline: true,
    controlsList: "nodownload noplaybackrate",
    disablePictureInPicture: true,
    onVolumeChange: (e) => silenceVideo(e.currentTarget),
    onLoadedMetadata: (e) => silenceVideo(e.currentTarget),
    onPlay: (e) => silenceVideo(e.currentTarget),
    onContextMenu: (e) => e.preventDefault(),
  };
}

export default function VideoMarks({ src }) {
  if (!src) return null;
  return (
    <div className="video-marks" aria-hidden="true">
      <img src={src} alt="" />
      <img src={src} alt="" />
      <img src={src} alt="" />
      <img src={src} alt="" />
    </div>
  );
}
