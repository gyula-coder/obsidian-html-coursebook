(() => {
  const range = document.getElementById("time");
  const dot = document.getElementById("dot");
  const output = document.getElementById("value");
  const play = document.getElementById("play");
  let animation = 0;
  let start = 0;
  const render = () => {
    dot.style.left = `${range.value}%`;
    output.textContent = `${range.value}%`;
  };
  const pause = () => {
    cancelAnimationFrame(animation);
    animation = 0;
    play.textContent = "Play animation";
  };
  const tick = (now) => {
    range.value = String(Math.round(((now - start) % 3000) / 30));
    render();
    animation = requestAnimationFrame(tick);
  };
  range.addEventListener("input", () => { pause(); render(); });
  play.addEventListener("click", () => {
    if (animation) { pause(); return; }
    start = performance.now() - Number(range.value) * 30;
    play.textContent = "Pause animation";
    animation = requestAnimationFrame(tick);
  });
  document.getElementById("reset").addEventListener("click", () => { pause(); range.value = "50"; render(); });
  render();
})();
