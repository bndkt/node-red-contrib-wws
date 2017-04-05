var request = require("request");
var rp = require("request-promise-native");

module.exports = function(RED) {
  function wwsGraphQLNode(config) {
    RED.nodes.createNode(this, config);
    var node = this;

    this.on("input", function(msg) {
      this.application = RED.nodes.getNode(config.application);
      if(this.application) {
        this.application.getAccessToken().then(function(auth) {
          wwsGraphQL(auth.accessToken, msg.payload, msg.topic).then(() => {
            console.log("Successfully posted message to WWS.");
            this.status({ fill: "green", shape: "dot", text: "connected" });
          }).catch((err) => {
            console.log("Error while posting message to WWS.", err);
            this.status({ fill: "red", shape: "ring", text: "disconnected" });
          });
        }).catch(function(err) {
          console.log("Error while asking for access token.", err);
          this.status({ fill: "red", shape: "ring", text: "disconnected" });
        });
      } else {
        this.error("No WWS Application configured.");
        this.status({ fill: "red", shape: "ring", text: "disconnected" });
      }
    });
  }

  RED.nodes.registerType("wws-graphql", wwsGraphQLNode);

  // Helper functions
  function wwsGraphQL(accessToken, actor, color, text, title) {
    var host = "https://api.watsonwork.ibm.com";
    var uri = host + "/graphql";
    var options = {
      method: "POST",
      uri: uri,
      headers: {
        Authorization: "Bearer " + accessToken
      },
      json: true,
      body: {
        operationName: operationName,
        query: query,
        variables: variables
      }
    };
    return rp(options);
  }
}