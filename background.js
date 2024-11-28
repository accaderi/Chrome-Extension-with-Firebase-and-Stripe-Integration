chrome.action.onClicked.addListener(() => {
  chrome.windows.create({
    url: 'window.html',
    type: 'popup',
    width: 800,
    height: 600
  });
}); 