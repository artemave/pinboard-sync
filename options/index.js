function saveOptions(e) {
  e.preventDefault();
  browser.storage.sync.set({
    "pinboard_access_token": document.querySelector("#apiKey").value
  });
}

function restoreOptions() {

  function setCurrentChoice(result) {
    document.querySelector("#apiKey").value = result.pinboard_access_token || "user_name:api_key";
  }

  function onError(error) {
    console.log(`Error: ${error}`);
  }

  var getting = browser.storage.sync.get("pinboard_access_token");
  getting.then(setCurrentChoice, onError);
}

document.addEventListener("DOMContentLoaded", restoreOptions);
document.querySelector("form").addEventListener("submit", saveOptions);
