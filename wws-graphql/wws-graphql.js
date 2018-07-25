var rp = require("request-promise-native");

module.exports = function (RED) {
  const ALL_FLAGS = "PUBLIC, BETA, DIRECT_MESSAGING, FAVORITES, USERSPACEATTRIBUTES, MENTION, TYPED_ANNOTATIONS, SPACE_TEMPLATE, SPACE_MEMBERS, EXPERIMENTAL";
  const BETA_EXP_FLAGS = "PUBLIC,BETA,EXPERIMENTAL";

  //
  //  Generic graphQL Node
  //
  function wwsGraphQLNode(config) {
    RED.nodes.createNode(this, config);
    this.application = RED.nodes.getNode(config.application);
    var node = this;

    //Check for token on start up
    if (!node.application || !node.application.hasAccessToken()) {
      node.error("Please configure your Watson Workspace App first!");
      node.status({fill: "red", shape: "dot", text: "token unavailable"});
    }

    // Helper Methods to simplify the code to initialize the token
    function _initializeToken() {
      if (!_isInitialized()) {
        const intervalObj = setInterval(() => {
          if (_isInitialized()) {
            clearInterval(intervalObj);
          }
        }, 2000);
      }
    }

    function _resetStatus() {
      setTimeout(() => {_isInitialized(); }, 2000);
    }

    function _isInitialized() {
      let token;
      if (node.application && node.application.hasAccessToken()) {
          token = node.application.getAccessToken(node);
      }
      return (token) ? true : false;
    };

    _initializeToken();

    this.on("input", (msg) => {
      if (!msg.payload) {
        console.log("No Payload Info");
        node.status({fill:"red", shape:"dot", text:"No Payload"});
        node.error("Missing required input in msg object: payload");
        return;
      }

      let host = node.application &&  node.application.getApiUrl() || "https://api.watsonwork.ibm.com";
      let bearerToken = msg.wwsToken || node.application.getAccessToken(node).access_token;
      
      var viewType = "PUBLIC";
      if (config.wwsBetaFeatures) viewType += ',BETA';
      if (config.wwsExperimentalFeatures) viewType += ',EXPERIMENTAL';

      console.log('viewType = ' + viewType);

      wwsGraphQL(bearerToken, host, msg.payload, viewType, msg.operationName, msg.variables).then((res) => {
        msg.payload = res.data;
        node.status({fill: "green", shape: "dot", text: "graphQL Query success"});
        console.log('Success from graphQL query');
        console.log(JSON.stringify(res, " ", 2));
        node.send(msg);
      }).catch((res) => {
        console.log("Error while posting GraphQL query to WWS." + JSON.stringify(res.error, " ", 2));
        node.status({fill: "red", shape: "ring", text: "Sending query failed..."});
      });
      _resetStatus();
    });
  }

  //
  //  parse Annotations to JSON
  //
  function _parseAnnotations(theAnnotations) {
    if (theAnnotations) {
      if (theAnnotations.length > 0) {
        let annotations = [];
        for (let i = 0; i < theAnnotations.length; i++) {
          annotations.push(JSON.parse(theAnnotations[i]));
        }
        return annotations;
      } else {
        return theAnnotations;
      }
    } else {
      return theAnnotations;
    }
  }


  //
  //  Get Message Details
  //
  function wwsGetMessage(config) {
    RED.nodes.createNode(this, config);
    this.application = RED.nodes.getNode(config.application);
    var node = this;

    //Check for token on start up
    if (!node.application || !node.application.hasAccessToken()) {
      node.error("Please configure your Watson Workspace App first!");
      node.status({fill: "red", shape: "dot", text: "token unavailable"});
    }
    function _isInitialized() {
      let token;
      if (node.application && node.application.hasAccessToken()) {
          token = node.application.getAccessToken(node);
      }
      return (token) ? true : false;
    };

    if (!_isInitialized()) {
      const intervalObj = setInterval(() => {
        if (_isInitialized()) {
          clearInterval(intervalObj);
        }
      }, 2000);
    }

    this.on("input", (msg) => {
      //
      //  get Space Id
      //
      var messageId = '';
      if ((config.wwsMessageId === '') && 
          ((msg.wwsMessageId === undefined) || (msg.wwsMessageId === ''))) {
        //
        //  There is an issue
        //
        console.log("Missing messageID Information");
        node.status({fill:"red", shape:"dot", text:"Missing messageID"});
        node.error('Missing messageID', msg);
        return;
      }
      if (config.wwsMessageId !== '') {
        messageId = config.wwsMessageId;
      } else {
        messageId = msg.wwsMessageId;
      }


      let host = node.application &&  node.application.getApiUrl() || "https://api.watsonwork.ibm.com";
      let bearerToken = msg.wwsToken || node.application.getAccessToken(node).access_token;

      var query = _getMessageInformation(messageId);
      //
      //  Perform the operation
      //
      wwsGraphQL(bearerToken, host, query, BETA_EXP_FLAGS).then((res) => {
        if (res.errors) {
          msg.payload = res.errors;
          console.log('errors getting Message ' + messageId);
          console.log(JSON.stringify(res.errors));
          node.status({fill: "red", shape: "dot", text: "errors getting Message " + messageId});
          node.error("errors getting Message " + messageId, msg);
          return;
        } else {
          //
          //  Successfull Result !
          //
          if (res.data.message) {
            msg.payload = res.data.message;
            console.log('Retrieving Message for messageID ' + messageId + ' succesfully completed!');
            msg.payload.annotations = _parseAnnotations(msg.payload.annotations);
          } else {
            //
            //  Message is VOID
            //
            msg.payload = res.data;
            console.log('Retrieving Message for messageID ' + messageId + ' returned an EMPTY MESSAGE - Returning res.data !!!');
          }
          console.log(JSON.stringify(res.data));
          node.status({fill: "green", shape: "dot", text: 'Retrieving Message for messageID ' + messageId + ' succesfully completed!'});
          node.send(msg);
        }
      }).catch((err) => {
        console.log("errors getting Message " + messageId, err);
        node.status({fill: "red", shape: "ring", text: "errors getting Message " + messageId});
        node.error("errors getting Message " + messageId, err);
        return;
      });
      setTimeout(() => {_isInitialized(); }, 2000);
    });
  }

  //
  //  Retrieve information about a list of people
  //
  function wwsGetPersons(config) {
    RED.nodes.createNode(this, config);
    this.application = RED.nodes.getNode(config.application);
    var node = this;
    var async = require("async");
    var asyncTasks = [];
        
    function _dummyCallback(err, item) {
      console.log('wwsGetPersons. : DUMMY CALLBACK ' + item);
    }

    function _beforeSend(theMsg) {
        console.log('wwsGetPersons._beforeSend: need to process ' + asyncTasks.length + ' async tasks...');
        //
        //  This is where the MAGIC of Async happens
        //
        if (asyncTasks.length > 0) {
            async.parallel(asyncTasks, function(err, results) {
                                            //
                                            // All tasks are done now
                                            //  We can return
                                            //
                                            console.log("wwsGetPersons._beforeSend : ready to send final information....");
                                            node.send(theMsg);
                                        }
            );                  
        } else {
            //
            //  Nothing asynchronous to do
            //  We can return immediatealy
            //
            node.send(theMsg);
        }
    }
    function _getPersonDetails(token, host, person, type, fullMsg, callback) {
      var query = '';
      if (type === "byMail") {
        query = 'query getPersonByMail {person(email: "' + person + '") {displayName extId email photoUrl customerId ibmUniqueID created updated presence id}}';
      } else {
        if (type === "byId") {
          query = 'query getPersonById {person(id: "' + person + '") {displayName extId email photoUrl customerId ibmUniqueID created updated presence id}}';
        } else {
          return;
        }
      }
      //
      //  Perform the operation
      //
      wwsGraphQL(token, host, query, BETA_EXP_FLAGS)
      .then((res) => {
        if (res.errors) {
          fullMsg.payload = res.errors;
          console.log('wwsGetPersons._getPersonDetails : errors getting ' + person);
          console.log(JSON.stringify(res.errors));
          node.status({fill: "red", shape: "dot", text: 'errors getting ' + person});
          node.error('errors getting ' + person, fullMsg);
          return;
        } else {
          //
          //  Successfull Result !
          //
          fullMsg.payload.push(res.data);
          console.log('wwsGetPersons._getPersonDetails : Person ' + person + ' succesfully retrieved !');
          console.log(JSON.stringify(res.data));
          node.status({fill: "green", shape: "dot", text: 'Person ' + person + ' succesfully retrieved !'});
          callback(null, person);
        }
      }).catch((err) => {
        console.log("wwsGetPersons._getPersonDetails : Errors while retrieveing " + person, err);
        node.status({fill: "red", shape: "ring", text: "Errors while retrieveing " + person});
        node.error("Errors while retrieveing " + person, err);
        return;
      });
    }

    //Check for token on start up
    if (!node.application || !node.application.hasAccessToken()) {
      node.error("Please configure your Watson Workspace App first!");
      node.status({fill: "red", shape: "dot", text: "token unavailable"});
    }
    function _isInitialized() {
      let token;
      if (node.application && node.application.hasAccessToken()) {
          token = node.application.getAccessToken(node);
      }
      return (token) ? true : false;
    };

    if (!_isInitialized()) {
      const intervalObj = setInterval(() => {
        if (_isInitialized()) {
          clearInterval(intervalObj);
        }
      }, 2000);
    }

    this.on("input", (msg) => {
      //
      //  Get People
      //
      var people = null;
      if ((config.wwsPersonList.trim() === '') && 
          ((msg.wwsPersonList === undefined) || (msg.wwsPersonList === null))) {
              console.log("wwsGetPersons._getPersonDetails : No Person to retrieve ");
              node.status({fill:"red", shape:"dot", text:"No Person to retrieve "});
              node.error("No Person to retrieve ");
              return;
      } else {
        if (config.wwsPersonList.trim() !== '') {
          //
          //  List of properties is a comma-separated list of  name=value
          //
          let theList = config.wwsPersonList.trim().split(',');
          for (let i=0; i < theList.length; i++) {
            theList[i] = theList[i].trim();
          }
          people = theList;
        } else {
          //
          //  List of properties is a comma-separated list of  name=value
          //
          let theList = msg.wwsPersonList.trim().split(',');
          for (let i=0; i < theList.length; i++) {
            theList[i] = theList[i].trim();
          }
          people = theList;
        }
      }


      let host = node.application &&  node.application.getApiUrl() || "https://api.watsonwork.ibm.com";
      let bearerToken = msg.wwsToken || node.application.getAccessToken(node).access_token;

      //
      //  We asynchronously execute all the things
      //
      msg.payload = [];
      asyncTasks = [];
      for (let k=0; k < people.length; k++) {
        asyncTasks.push(function(_dummyCallback) {
          _getPersonDetails(bearerToken, host, people[k].trim(), config.PeopleOperation, msg, _dummyCallback);
        });
      }
      _beforeSend(msg);
      setTimeout(() => {_isInitialized(); }, 2000);
    });
  }


  //
  //  Add/Remove Members from a space
  //
  function wwsAddRemoveMembers(config) {
    RED.nodes.createNode(this, config);
    this.application = RED.nodes.getNode(config.application);
    var node = this;

    //Check for token on start up
    if (!node.application || !node.application.hasAccessToken()) {
      node.error("Please configure your Watson Workspace App first!");
      node.status({fill: "red", shape: "dot", text: "token unavailable"});
    }
    function _isInitialized() {
      let token;
      if (node.application && node.application.hasAccessToken()) {
          token = node.application.getAccessToken(node);
      }
      return (token) ? true : false;
    };

    if (!_isInitialized()) {
      const intervalObj = setInterval(() => {
        if (_isInitialized()) {
          clearInterval(intervalObj);
        }
      }, 2000);
    }

    this.on("input", (msg) => {
      //
      //  get Space Id
      //
      var spaceId = '';
      if ((config.wwsSpaceId === '') && 
          ((msg.wwsSpaceId === undefined) || (msg.wwsSpaceId === ''))) {
        //
        //  There is an issue
        //
        console.log("Missing spaceId Information");
        node.status({fill:"red", shape:"dot", text:"Missing spaceID"});
        node.error('Missing spaceID', msg);
        return;
      }
      if (config.wwsSpaceId !== '') {
        spaceId = config.wwsSpaceId;
      } else {
        spaceId = msg.wwsSpaceId;
      }
      //
      //  Get Members
      //
      var members = null;
      if ((config.wwsMemberList.trim() === '') && 
          ((msg.wwsMemberList === undefined) || (msg.wwsMemberList === null))) {
        //
        //  No Members to be added  
        //  I am fine with this
        //
      } else {
        if (config.wwsMemberList.trim() !== '') {
          //
          //  List of properties is a comma-separated list of  name=value
          //
          let theList = config.wwsMemberList.trim().split(',');
          for (let i=0; i < theList.length; i++) {
            theList[i] = theList[i].trim();
          }
          members = theList;
        } else {
          //
          //  List of properties is a comma-separated list of  name=value
          //
          let theList = msg.wwsMemberList.trim().split(',');
          for (let i=0; i < theList.length; i++) {
            theList[i] = theList[i].trim();
          }
          members = theList;
        }
      }

      let host = node.application &&  node.application.getApiUrl() || "https://api.watsonwork.ibm.com";
      let bearerToken = msg.wwsToken || node.application.getAccessToken(node).access_token;


      var mutation = _AddOrRemoveMutation(spaceId, members, config.ARoperation);
      //
      //  Perform the operation
      //
      wwsGraphQL(bearerToken, host, mutation, BETA_EXP_FLAGS)
      .then((res) => {
        if (res.errors) {
          msg.payload = res.errors;
          console.log('errors adding/removing Members');
          console.log(JSON.stringify(res.errors));
          node.status({fill: "red", shape: "dot", text: "errors adding/removing Members"});
          node.error("errors adding/removing Members", msg);
          return;
        } else {
          //
          //  Successfull Result !
          //
          msg.payload = res.data;
          console.log('Members operation ' + config.ARoperation + ' succesfully completed !');
          console.log(JSON.stringify(res.data));
          node.status({fill: "green", shape: "dot", text: 'Members operation ' + config.ARoperation + ' succesfully completed !'});
          node.send(msg);
        }
      }).catch((err) => {
        console.log("Errors while adding/removing Members", err);
        node.status({fill: "red", shape: "ring", text: "Errors while adding/removing Members..."});
        node.error("Errors while adding/removing Members...", err);
        return;
      });
      setTimeout(() => {_isInitialized(); }, 2000);
    });
  }

  //
  //  This node gets the Annotation referred to by a message containing the "Action-Selected" actionId
  //
  function wwsFilterActions(config) {
    RED.nodes.createNode(this, config);
    this.application = RED.nodes.getNode(config.application);
    var node = this;

    //Check for token on start up
    if (!node.application || !node.application.hasAccessToken()) {
      node.error("Please configure your Watson Workspace App first!");
      node.status({fill: "red", shape: "dot", text: "token unavailable"});
    }
    function _isInitialized() {
      let token;
      if (node.application && node.application.hasAccessToken()) {
          token = node.application.getAccessToken(node);
      }
      return (token) ? true : false;
    };

    if (!_isInitialized()) {
      const intervalObj = setInterval(() => {
        if (_isInitialized()) {
          clearInterval(intervalObj);
        }
      }, 2000);
    }

    this.on("input", (msg) => {
      var actionId;
      var actionList;
      var referralMessageId;
      var parExp = /(.*?)\s\((.*?)\)/;

      //
      //  Get the incoming action
      //
      if ((config.wwsActionId === '') && 
          ((msg.wwsActionId === undefined) || (msg.wwsActionId === ''))) {
        //
        //  There is an issue
        //
        console.log("wwsFilterActions: Missing actionId Information");
        node.status({fill:"red", shape:"dot", text:"Missing actionId Information"});
        node.error('Missing actionId Information', msg);
        return;
      }
      if (config.wwsActionId !== '') {
        actionId = config.wwsActionId.trim();
      } else {
        actionId = msg.wwsActionId.trim();
      }

      //
      //  Get the list of Actions the node is able to deal with
      //
      if ((config.wwsActionsList === '') && 
          ((msg.wwsActionsList === undefined) || (msg.wwsActionsList === ''))) {
        //
        //  There is an issue
        //
        console.log("wwsFilterActions: Missing ActionsList Information");
        node.status({fill:"red", shape:"dot", text:"Missing ActionsList"});
        node.error('Missing ActionsList', msg);
        return;
      }
      if (config.wwsActionsList !== '') {
        actionList = config.wwsActionsList.split(',');
      } else {
        actionList = msg.wwsActionsList.split(',');
      }

      //
      //  Preparing the attribute which contains the Skeleton for the "createTargetedMessage" Mutation
      //
      if (msg.wwsEvent && msg.wwsEvent.annotationPayload) {
        let payload = JSON.parse(msg.wwsEvent.annotationPayload);
        if (payload.conversationId && payload.targetDialogId && payload.updatedBy) {
          msg.wwsAFMutation = _buildTargetedMessage(payload.conversationId, payload.updatedBy, payload.targetDialogId);
          console.log("wwsFilterActions: CreateTargetedMessage Mutation succesfully built and Returned !");
        } else {
          console.log("wwsFilterActions: CreateTargetedMessage Mutation not built : missing parameters !");
        }
      } else {
        console.log("wwsFilterActions: CreateTargetedMessage Mutation not built : missing wwsEvent or annotationPayload !");
      }
      //
      //  Check if the incoming actionId is in the list
      //
      var selectedRule = -1;
      for (let i=0; i < actionList.length; i++) {
        let theAction = actionList[i].trim();
        if (theAction.match(parExp)) {
          //
          //  There is the LENS in parenthesis. So we get the part outside parenthseis
          //
          theAction = theAction.match(parExp)[1].trim();
        }
        if (matchRuleShort(actionId, theAction)) {
          selectedRule = i;
          break;
        }
      }
      if (selectedRule === -1) {
        console.log('wwsFilterActions: Selected Rule is : ' + selectedRule + ' (over ' + actionList.length + ') : OTHERWISE');
        console.log('wwsFilterActions: ActionId ' + actionId + ' does not match input ActionsList');
        //
        //  Build an output array of messages where all the messages are NULL except the Last one (OTHERWISE)
        //
        var outArray = [];
        for (let i=0; i < actionList.length; i++) {
          outArray.push(null);
        }
        outArray.push(msg);
        node.status({fill:"yellow", shape:"dot", text:"Action " + actionId + " not found -> Going OTHERWISE"});
        node.send(outArray);
        return;
      }

      //
      //  At this point, we know that we are trying to match an ActionId which is in the list
      //
      //  If the ActionId does not correspond to a LENS (intent), we do not have to do much....
      //
      console.log('wwsFilterActions: Selected Rule is : ' + selectedRule + ' (over ' + actionList.length + ') : ' + actionList[selectedRule].trim());
      console.log('wwsFilterActions: processing .....');
      var theAction = actionList[selectedRule].trim();
      if (theAction.match(parExp) === null) {
        console.log('wwsFilterActions: Selected Rule ' + actionList[selectedRule].trim() + ' has NO LENS. Returning....');
        //
        //  Build the output Array (as the node has multiple outputs)
        //  all the outputs will be initialized to NULL
        //
        let outArray2 = [];
        for (let i=0; i <= actionList.length; i++) {
          outArray2.push(null);
        }
        //
        //  the array item corresponding to the selectedRule is filled with the INCOMING MESSAGE
        //
        outArray2[selectedRule] = msg;
        //  
        //  Sends the output array
        //
        node.status({fill:"green", shape:"dot", text:"No Lens for Action " + actionId});
        node.send(outArray2);  
        return;      
      }

      //
      //  If the ActionId has a lens, then we need to get the one annotation (message-focus) which corresponds to the Actios ID.
      //  In order to do this, we need to fetch the message to which the annotation refers to 
      //
      //  Check the presence of the wwsReferralMsgId input
      //  It is only required in this case !!!!
      //
      if ((config.wwsReferralMsgId === '') && 
          ((msg.wwsReferralMsgId === undefined) || (msg.wwsReferralMsgId === ''))) {
        //
        //  There is an issue
        //
        console.log("wwsFilterActions: Missing ReferralMsgId Information");
        node.status({fill:"red", shape:"dot", text:"Missing ReferralMsgId"});
        node.error('Missing ReferralMsgId', msg);
        return;
      }
      if (config.wwsReferralMsgId && (config.wwsReferralMsgId !== '')) {
        referralMessageId = config.wwsReferralMsgId.trim();
      } else {
        referralMessageId = msg.wwsReferralMsgId.trim();
      }
      
      //
      //  Check to find the one that is "message-focus" and corresponds to the lens=ActionId
      //
      var lens = theAction.match(parExp)[2].trim();
      console.log('wwsFilterActions: Selected Rule ' + actionList[selectedRule].trim() + ' has Lens ' + lens);
      node.status({fill: "blue", shape: "dot", text: "Ready to get lens " + lens});
      //
      //  If the ActionId has a lens, then we need to get the one annotation from the referralMsessageId which
      //  corresponds to the Actios ID.
      //  So we are ready to build the graphQL query to retrieve the annotations 
      //
      var accessToken = this.application.verifyAccessToken(tokenFsm.getAccessToken(), this);
      var bearerToken = msg.wwsToken || accessToken.token.access_token;
      var host = this.application.api;
      var query = 'query getAnnotations { message(id: "' + referralMessageId + '"){annotations}}';
      //
      //  Retrieve the annotations for the given Message
      //
      wwsGraphQL(bearerToken, host, query, "PUBLIC")
      .then((res) => {
        if (res.errors) {
          //
          //  Should NOT BE...
          //
          msg.payload = res.errors;
          console.log('wwsFilterActions: errors from query');
          console.log(JSON.stringify(res.errors));
          node.status({fill: "red", shape: "dot", text: "Errors from query"});
          node.error('Errors from query', msg);
        } else {
          //
          //  Ok, we got the array of annotations...
          //
          console.log('wwsFilterActions: Success from graphQL query : Annotations retrieved');
          console.log(JSON.stringify(res.data, ' ', 2));
          node.status({fill: "green", shape: "dot", text: "Annotations retrieved..."});
          //
          //  Now we have the annotations. Check to find the one that is "message-focus" and corresponds to the lens=ActionId
          //
          var found = false;
          if (res.data.message) {
            for (let i=0; i < res.data.message.annotations.length; i++) {
              let intent = JSON.parse(res.data.message.annotations[i]);
              if ((intent.type === "message-focus") && (intent.lens === lens)) {
                msg.payload = intent;
                if (msg.payload.payload) msg.payload.payload = __myJSONparse(msg.payload.payload);
                if (msg.payload.context) msg.payload.context = __myJSONparse(msg.payload.context);
                found = true;
                break;
              }
            }
          }
          if (found) {
            console.log('wwsFilterActions: Lens ' + lens + ' found. Returning Message-Focus....');
            //
            //  Build the output Array (as the node has multiple outputs)
            //  all the outputs will be initialized to NULL
            //
            var outArray = [];
            for (let i=0; i <= actionList.length; i++) {
              outArray.push(null);
            }
            //
            //  the array item corresponding to the selectedRule is filled with the result
            //
            outArray[selectedRule] = msg;
            //  
            //  Sends the output array
            //
            node.status({fill: "green", shape: "dot", text: "Lens " + lens + " returned"});
            node.send(outArray);
          } else {
            //
            //  Strange situation (no annotations or the LENS was not found....)
            //
            console.log("wwsFilterActions: Error while dealing with action " + actionId + ' for lens ' + lens);
            node.status({fill: "red", shape: "ring", text: "Error while dealing with action " + actionId + ' for lens ' + lens});
            node.error('Lens ' + lens + ' not found for action ' + actionId, msg);
          }
        }})
        .catch((err) => {
          msg.payload = err;
          console.log("wwsFilterActions: Error while posting GraphQL query to WWS.", err);
          node.status({fill: "red", shape: "ring", text: "Sending query failed..."});
          node.error('Error while posting GraphQL query to WWS.', msg);
        });
        setTimeout(() => {_isInitialized();}, 2000);
    });
  }

  //
  //  Get Template
  //
  function wwsGetTemplate(config) {
    RED.nodes.createNode(this, config);
    this.application = RED.nodes.getNode(config.application);
    var node = this;

    //Check for token on start up
    if (!node.application || !node.application.hasAccessToken()) {
      node.error("Please configure your Watson Workspace App first!");
      node.status({fill: "red", shape: "dot", text: "token unavailable"});
    }
    function _isInitialized() {
      let token;
      if (node.application && node.application.hasAccessToken()) {
          token = node.application.getAccessToken(node);
      }
      return (token) ? true : false;
    };

    if (!_isInitialized()) {
      const intervalObj = setInterval(() => {
        if (_isInitialized()) {
          clearInterval(intervalObj);
        };
      }, 2000);
    };

    this.on("input", (msg) => {
      var templateId = '';
      if ((config.wwsTemplateId === '') && 
          ((msg.wwsTemplateId === undefined) || (msg.wwsTemplateId === ''))) {
        //
        //  There is an issue
        //
        console.log("Missing templateID Information");
        node.status({fill:"red", shape:"dot", text:"Missing TemplateID"});
        node.error('Missing TemplateID', msg);
        return;
      }
      if (config.wwsTemplateId !== '') {
        templateId = config.wwsTemplateId;
      } else {
        templateId = msg.wwsTemplateId;
      }


      let host = node.application &&  node.application.getApiUrl() || "https://api.watsonwork.ibm.com";
      let bearerToken = msg.wwsToken || node.application.getAccessToken(node).access_token;

      var query = _getTemplateQuery(templateId);
      console.log(query);
      //
      //  Retrieve the space info
      //
      wwsGraphQL(bearerToken, host, query, BETA_EXP_FLAGS)
      .then((res) => {
        if (res.errors) {
          msg.payload = res.errors;
          console.log('errors from query');
          console.log(JSON.stringify(res.errors));
          node.status({fill: "red", shape: "dot", text: "Errors from query"});
          node.error("Errors from query", msg);
          return;
        } else {
          //
          //  Successfull Result !
          //
          msg.payload = res.data;
          console.log('Success from graphQL query');
          console.log(JSON.stringify(res.data));
          node.status({fill: "green", shape: "dot", text: "graphQL Query success"});
          node.send(msg);
        }
      }).catch((err) => {
        console.log("Error while posting GraphQL query to WWS.", err);
        node.status({fill: "red", shape: "ring", text: "Sending query failed..."});
        node.error("Sending query failed...", err);
        return;
      });
      setTimeout(() => {_isInitialized(); }, 2000);
    });
  }
  

  //
  //  Get Templated Space
  //
  function wwsGetTemplatedSpace(config) {
    RED.nodes.createNode(this, config);
    this.application = RED.nodes.getNode(config.application);
    var node = this;

    //Check for token on start up
    if (!node.application || !node.application.hasAccessToken()) {
      node.error("Please configure your Watson Workspace App first!");
      node.status({fill: "red", shape: "dot", text: "token unavailable"});
    }
    function _isInitialized() {
      let token;
      if (node.application && node.application.hasAccessToken()) {
          token = node.application.getAccessToken(node);
      }
      return (token) ? true : false;
    };

    if (!_isInitialized()) {
      const intervalObj = setInterval(() => {
        if (_isInitialized()) {
          clearInterval(intervalObj);
        };
      }, 2000);
    };

    this.on("input", (msg) => {
      var spaceId = '';
      if ((config.wwsSpaceId === '') && 
          ((msg.wwsSpaceId === undefined) || (msg.wwsSpaceId === ''))) {
        //
        //  There is an issue
        //
        console.log("Missing spaceID Information");
        node.status({fill:"red", shape:"dot", text:"Missing SpaceID"});
        node.error('Missing SpaceID', msg);
        return;
      }
      if (config.wwsSpaceId !== '') {
        spaceId = config.wwsSpaceId;
      } else {
        spaceId = msg.wwsSpaceId;
      }


      let host = node.application &&  node.application.getApiUrl() || "https://api.watsonwork.ibm.com";
      let bearerToken = msg.wwsToken || node.application.getAccessToken(node).access_token;

      var query = _getTemplatedSpaceQuery(spaceId);
      console.log(query);
      //
      //  Retrieve the space info
      //
      wwsGraphQL(bearerToken, host, query, BETA_EXP_FLAGS)
      .then((res) => {
        if (res.errors) {
          msg.payload = res.errors;
          console.log('errors from query');
          console.log(JSON.stringify(res.errors));
          node.status({fill: "red", shape: "dot", text: "Errors from query"});
          node.error("Errors from query", msg);
          return;
        } else {
          //
          //  Successfull Result !
          //
          msg.payload = res.data;
          console.log('Success from graphQL query');
          console.log(JSON.stringify(res.data));
          node.status({fill: "green", shape: "dot", text: "graphQL Query success"});
          //
          //  Now we need to modify the properties in the output to be more descriptive
          //
          msg.payload.space.propertyValueIds = _propertiesIdsToNames(msg.payload.space.propertyValueIds, msg.payload.space.templateInfo.properties.items);
          //
          //  And now we need to add the name of the status
          //
          let statuses = msg.payload.space.templateInfo.spaceStatus.acceptableValues;
          let found = false;
          for (let i = 0; i < statuses.length; i++) {
            if (msg.payload.space.statusValueId === statuses[i].id) {
              found = true;
              msg.payload.space.statusValueName = statuses[i].displayName;
              break;
            }
          }
          if (!found) {
            //
            //  We cannot Set a status that does not exist
            //
            console.log('Status ' + msg.payload.space.statusValueId + ' is unknown!');
            node.status({fill: "red", shape: "dot", text: 'Status ' + msg.payload.space.statusValueId + ' is unknown!'});
            node.error('Status ' + msg.payload.space.statusValueId + ' is unknown!', msg);
            return;
          }
          node.send(msg);
        }
      }).catch((err) => {
        console.log("Error while posting GraphQL query to WWS.", err);
        node.status({fill: "red", shape: "ring", text: "Sending query failed..."});
        node.error("Sending query failed...", err);
        return;
      });
      setTimeout(() => {_isInitialized(); }, 2000);
    });
  }

  //
  //  Update Templated Space
  //
  function wwsUpdateSpace(config) {
    RED.nodes.createNode(this, config);
    this.application = RED.nodes.getNode(config.application);
    var node = this;

    var betweenQuotes = /"([^"\\]*(\\.[^"\\]*)*)"/;
    var parExp = /(\S+)\s*=\s*([^\s"]+|"[^"]*")/;

    //Check for token on start up
    if (!node.application || !node.application.hasAccessToken()) {
      node.error("Please configure your Watson Workspace App first!");
      node.status({fill: "red", shape: "dot", text: "token unavailable"});
    }
    function _isInitialized() {
      let token;
      if (node.application && node.application.hasAccessToken()) {
          token = node.application.getAccessToken(node);
      }
      return (token) ? true : false;
    };

    if (!_isInitialized()) {
      const intervalObj = setInterval(() => {
        if (_isInitialized()) {
          clearInterval(intervalObj);
        };
      }, 2000);
    };

    this.on("input", (msg) => {
      //
      //  Get the SpaceID
      //
      var spaceId = '';
      if ((config.wwsSpaceId === '') && 
          ((msg.wwsSpaceId === undefined) || (msg.wwsSpaceId === ''))) {
        //
        //  There is an issue
        //
        console.log("Missing spaceID Information");
        node.status({fill:"red", shape:"dot", text:"Missing SpaceID"});
        node.error('Missing SpaceID', msg);
        return;
      }
      if (config.wwsSpaceId !== '') {
        spaceId = config.wwsSpaceId;
      } else {
        spaceId = msg.wwsSpaceId;
      }
      //
      //  Get the Properties to be modified
      //
      var properties = null;
      if ((config.wwsPropertyList.trim() === '') && 
          ((msg.wwsPropertyList === undefined) || (msg.wwsPropertyList === null))) {
        //
        //  No Properties to be modified! 
        //  I am fine with this
        //
      } else {
        if (config.wwsPropertyList.trim() !== '') {
          //
          //  List of properties is a comma-separated list of  name=value
          //
          var theList = config.wwsPropertyList.trim().split(',');
          for (let i=0; i < theList.length; i++) {
            var tt = theList[i].match(parExp);
            if (tt) {
              //
              //  well written name = value   pair
              //
              var theProperty = {};
              theProperty.name = tt[1].trim();

              var tmpS = tt[2].trim();
              if (tmpS.match(betweenQuotes)) {
                theProperty.value = tmpS.match(betweenQuotes)[1];
              } else {
                theProperty.value = tmpS;
              }
              if (properties === null) properties = new Array;
              properties.push(theProperty);
            }
          }
          //
          //  Now we shoudl have processed all the pairs in the config input
          //
        } else {
          //
          //  if inpput comes as "msg.wwsPropertyList" we assume that it is already formatted as an array of name and values
          //
          properties = msg.wwsPropertyList;
        }
      }
      //
      //  Get the new Status for the Space
      //
      var newStatus = null;
      if ((config.wwsNewStatus.trim() === '') && 
          ((msg.wwsNewStatus === undefined) || (msg.wwsNewStatus === ''))) {
        //
        //  Status does not need to be modified 
        //  I am fine with this
        //
      } else {
        if (config.wwsNewStatus.trim() !== '') {
          //
          //  Now we shoudl have processed all the pairs in the config input
          //
          newStatus = config.wwsNewStatus.trim();
        } else {
          //
          //  if inpput comes as "msg.wwsPropertyList" we assume that it is already formatted as an array of name and values
          //
          newStatus = msg.wwsNewStatus.trim();
        }
      }
      //
      //  Get Members
      //
      var members = null;
      if ((config.wwsMemberList.trim() === '') && 
          ((msg.wwsMemberList === undefined) || (msg.wwsMemberList === null))) {
        //
        //  No Members to be added  
        //  I am fine with this
        //
      } else {
        if (config.wwsMemberList.trim() !== '') {
          //
          //  List of properties is a comma-separated list of  name=value
          //
          let theList = config.wwsMemberList.trim().split(',');
          for (let i=0; i < theList.length; i++) {
            theList[i] = theList[i].trim();
          }
          members = theList;
        } else {
          //
          //  List of properties is a comma-separated list of  name=value
          //
          let theList = msg.wwsMemberList.trim().split(',');
          for (let i=0; i < theList.length; i++) {
            theList[i] = theList[i].trim();
          }
          members = theList;
        }
      }
      //
      //  If there is nothing to be modified, then we exit without doing anything :-)
      //
      if ((newStatus === null) && (properties === null) && (members === null)) {
        //
        //  There is nothing to do
        //
        console.log("Nothing to UPDATE");
        node.status({fill:"yellow", shape:"dot", text:"Nothing to update"});
        node.send(msg);
        return;
      }
      //
      //  Since there is something to do, we need to translate property names, property values (for lists) and statusValues from readable strings to IDs
      //  In order to do this, we first need to get information about the template from which this space has been created
      //
      let host = node.application &&  node.application.getApiUrl() || "https://api.watsonwork.ibm.com";
      let bearerToken = msg.wwsToken || node.application.getAccessToken(node).access_token;
      var query = _getTemplatedSpaceQuery(spaceId);
      wwsGraphQL(bearerToken, host, query, BETA_EXP_FLAGS)
      .then((res) => {
        if (res.errors) {
          msg.payload = res.errors;
          console.log('errors getting the Template');
          console.log(JSON.stringify(res.errors));
          node.status({fill: "red", shape: "dot", text: "Errors getting the Template"});
          node.error("Errors getting the Template", msg);
          return;
        } else {
          //
          //  Ok, we should have the information about the teamplate.
          //  We need to parse them
          //
          node.status({fill: "green", shape: "dot", text: "Template succesfully retrieved"});
          var templateInfo = res.data.space.templateInfo;
          if (newStatus) {
            //
            //  there is a translation to be made on Status
            //
            let statuses = templateInfo.spaceStatus.acceptableValues;
            let found = false;
            for (let i=0; i < statuses.length; i++) {
              if (newStatus === statuses[i].displayName) {
                found = true;
                newStatus = statuses[i].id;
                break;
              }
            }
            if (!found) {
              //
              //  We cannot Set a status that does not exist
              //
              console.log('Status ' + newStatus + ' is unknown!');
              node.status({fill: "red", shape: "dot", text: 'Status ' + newStatus + ' is unknown!'});
              node.error('Status ' + newStatus + ' is unknown!', msg);
              return;
            }
          }
          let outProps;
          if (properties) {
            //
            //  there is a translation to be done for properties :-)
            //
            outProps = _propertiesNamesToIds(properties, templateInfo.properties.items);
            if (!Array.isArray(outProps)) {
              //
              //  There was an issue in Processing
              //
              console.log(properties[outProps].name + ' is unknown or its value ' + properties[outProps].value);
              node.status({fill: "red", shape: "dot", text: properties[outProps].name + ' is unknown or its value ' + properties[outProps].value});
              node.error(properties[outProps].name + ' is unknown or its value ' + properties[outProps].value, msg);
              return;
            }
          }
          //
          //  Now we can proceed building the mutation to modify the space
          //  Build the mutation
          //
          var mutation = _updateSpaceMutation();
          //
          //  Build the Variables
          //
          var variables = '{"input":';
          variables += '{"id":"' + spaceId + '"';
          //
          //  Add Members if any
          //
          if (members) {
            variables += ', "members":[';
            for (let k=0; k < members.length; k++) {
              variables += '"' + members[k] + '"';
              if (k === (members.length - 1)) {
                variables += ']';
              } else {
                variables += ',';
              }
            }
            variables += ', "memberOperation" : "ADD"';
          }
          //
          //  Add properties if any
          //
          if (outProps) {
            variables += ', "propertyValues":[';
            for (let i=0; i < outProps.length; i++) {
              if (i != 0 ) variables += ",";
              variables += '{"propertyId":"' + outProps[i].id + '", "propertyValueId":"' + outProps[i].valueId + '"}';
            }
            variables += ']';
          }
          //
          //  Add Status if any
          //
          if (newStatus) {
            variables += ', "statusValue" : {"statusValueId" : "' + newStatus + '"}'
          }
          variables += '}}';
          console.log('Updating Space ' + spaceId + ' with these data :');
          console.log(variables);
          console.log('------------------');
          //
          //  Issue the Update Statement
          //
          wwsGraphQL(bearerToken, host, mutation, ALL_FLAGS, variables)
          .then((res) => {
            if (res.errors) {
              msg.payload = res.errors;
              console.log('errors updating space ' + spaceId);
              console.log(JSON.stringify(res.errors));
              node.status({fill: "red", shape: "dot", text: 'errors updating space ' + spaceId});
              node.error('errors updating space ' + spaceId, msg);
            } else {
              msg.payload = res.data.updateSpace;
              console.log('Space ' + spaceId + ' UPDATED !!');
              console.log(JSON.stringify(res.data));
              node.status({fill: "green", shape: "dot", text: "Space Updated !"});
              //
              //  Now we need to modify the properties in the output to be more descriptive
              //
              msg.payload.space.propertyValueIds = _propertiesIdsToNames(msg.payload.space.propertyValueIds, templateInfo.properties.items);
              //
              //  And now we need to add the name of the status
              //
              let statuses = templateInfo.spaceStatus.acceptableValues;
              let found = false;
              for (let i=0; i < statuses.length; i++) {
                if (msg.payload.space.statusValueId === statuses[i].id) {
                  found = true;
                  msg.payload.space.statusValueName = statuses[i].displayName;
                  break;
                }
              }
              if (!found) {
                //
                //  We cannot Set a status that does not exist
                //
                console.log('Status ' + msg.payload.space.statusValueId + ' is unknown!');
                node.status({fill: "red", shape: "dot", text: 'Status ' + msg.payload.space.statusValueId + ' is unknown!'});
                node.error('Status ' + msg.payload.space.statusValueId + ' is unknown!', msg);
                return;
              }
              node.send(msg);
            }
          }).catch((err) => {
            console.log("Error updating space.", err);
            node.status({fill: "red", shape: "ring", text: "Error updating space..."});
            node.error("Error updating space.", err);
          });
        }
      }).catch((err) => {
        console.log("Error while getting templatedSpace.", err);
        node.status({fill: "red", shape: "ring", text: "Error while getting templatedSpace..."});
        node.error("Error while getting templatedSpace.", err);
        return;
      });
      setTimeout(() => {_isInitialized(); }, 2000);
    });
  }


  //
  //  Create Space from Template
  //
  function wwsCreateSpaceFromTemplate(config) {
    RED.nodes.createNode(this, config);
    this.application = RED.nodes.getNode(config.application);
    var node = this;

    var betweenQuotes = /"([^"\\]*(\\.[^"\\]*)*)"/;
    var parExp = /(\S+)\s*=\s*([^\s"]+|"[^"]*")/;

    //Check for token on start up
    if (!node.application || !node.application.hasAccessToken()) {
      node.error("Please configure your Watson Workspace App first!");
      node.status({fill: "red", shape: "dot", text: "token unavailable"});
    }
    function _isInitialized() {
      let token;
      if (node.application && node.application.hasAccessToken()) {
          token = node.application.getAccessToken(node);
      }
      return (token) ? true : false;
    };

    if (!_isInitialized()) {
      const intervalObj = setInterval(() => {
        if (_isInitialized()) {
          clearInterval(intervalObj);
        };
      }, 2000);
    };

    this.on("input", (msg) => {
      //
      //  Get the templateID
      //
      var templateId = '';
      if ((config.wwsTemplateId === '') && 
          ((msg.wwsTemplateId === undefined) || (msg.wwsTemplateId === ''))) {
        //
        //  There is an issue
        //
        console.log("Missing templateID Information");
        node.status({fill:"red", shape:"dot", text:"Missing templateID"});
        node.error('Missing templateID', msg);
        return;
      }
      if (config.wwsTemplateId !== '') {
        templateId = config.wwsTemplateId;
      } else {
        templateId = msg.wwsTemplateId;
      }
      //
      //  Get the new space Name
      //
      var spaceName = '';
      if ((config.wwsSpaceName === '') && 
          ((msg.wwsSpaceName === undefined) || (msg.wwsSpaceName === ''))) {
        //
        //  There is an issue
        //
        console.log("Missing Space Name Information");
        node.status({fill:"red", shape:"dot", text:"Missing Space Name"});
        node.error('Missing Space Name', msg);
        return;
      }
      if (config.wwsSpaceName !== '') {
        spaceName = config.wwsSpaceName;
      } else {
        spaceName = msg.wwsSpaceName;
      }
      //
      //  Get the Properties to be modified
      //
      var properties = null;
      if ((config.wwsPropertyList.trim() === '') && 
          ((msg.wwsPropertyList === undefined) || (msg.wwsPropertyList === null))) {
        //
        //  No Properties to be modified! 
        //  I am fine with this
        //
      } else {
        if (config.wwsPropertyList.trim() !== '') {
          //
          //  List of properties is a comma-separated list of  name=value
          //
          let theList = config.wwsPropertyList.trim().split(',');
          for (let i=0; i < theList.length; i++) {
            let tt = theList[i].match(parExp);
            if (tt) {
              //
              //  well written name = value   pair
              //
              let theProperty = {};
              theProperty.name = tt[1].trim();

              let tmpS = tt[2].trim();
              if (tmpS.match(betweenQuotes)) {
                theProperty.value = tmpS.match(betweenQuotes)[1];
              } else {
                theProperty.value = tmpS;
              }
              if (properties === null) properties = new Array;
              properties.push(theProperty);
            }
          }
          //
          //  Now we shoudl have processed all the pairs in the config input
          //
        } else {
          //
          //  if inpput comes as "msg.wwsPropertyList" we assume that it is already formatted as an array of name and values
          //
          properties = msg.wwsPropertyList;
        }
      }
      //
      //  Get Members
      //
      var members = null;
      if ((config.wwsMemberList.trim() === '') && 
          ((msg.wwsMemberList === undefined) || (msg.wwsMemberList === null))) {
        //
        //  No Members to be added  
        //  I am fine with this
        //
      } else {
        if (config.wwsMemberList.trim() !== '') {
          //
          //  List of properties is a comma-separated list of  name=value
          //
          let theList = config.wwsMemberList.trim().split(',');
          for (let i=0; i < theList.length; i++) {
            theList[i] = theList[i].trim();
          }
          members = theList;
        } else {
          //
          //  List of properties is a comma-separated list of  name=value
          //
          let theList = msg.wwsMemberList.trim().split(',');
          for (let i=0; i < theList.length; i++) {
            theList[i] = theList[i].trim();
          }
          members = theList;
        }
      }
      //
      //  Since there is something to do, we need to tranlsta property names, property values (fooor lists) and statusValues from readable strings to IDs
      //  In order to do this, we first need to get information about the template
      //
      let host = node.application &&  node.application.getApiUrl() || "https://api.watsonwork.ibm.com";
      let bearerToken = msg.wwsToken || node.application.getAccessToken(node).access_token;
      //
      //  The Mutation is independent if there are Properties or not (this will change the way in which the "variables" will be defined)
      //  So we can define the mutation upfront
      //
      var mutation = _createSpaceMutation();
      //
      //  start build the variables
      //
      var variables = '{"input":';
      variables += '{"templateId":"' + templateId + '",';
      variables += '"title":"' + spaceName + '",';
      variables += '"visibility":"PRIVATE"';
      //
      //  Add Members if any
      //
      if (members) {
        variables += ', "members":[';
        for (let k=0; k < members.length; k++) {
          variables += '"' + members[k] + '"';
          if (k === (members.length - 1)) {
            variables += ']';
          } else {
            variables += ',';
          }
        }
        //variables += ', "memberOperation" : "ADD"';
      }
      //
      //  At this point, we need to get the Template
      //
      let query = _getTemplateQuery(templateId);
      //
      //  Retrieve the template info
      //
      wwsGraphQL(bearerToken, host, query, BETA_EXP_FLAGS)
      .then((res) => {
        if (res.errors) {
          msg.payload = res.errors;
          console.log("Errors retrieving TemplateId " + templateId);
          console.log(JSON.stringify(res.errors));
          node.status({fill: "red", shape: "dot", text: "Errors retrieving TemplateId " + templateId});
          node.error("Errors Retrieving TemplateId " + templateId, msg);
          return;
        } else {
          //
          //  Successfull Result ! HABEMUS TEMPLATE
          //
          let templateProperties = res.data.spaceTemplate.properties.items;
          let statuses = res.data.spaceTemplate.spaceStatus.acceptableValues;
          //
          //  Now we have to validate the properties
          //
          if (properties) {
            let outProperties = _propertiesNamesToIds(properties, templateProperties);
            if (Array.isArray(outProperties)) {
              //
              //  We have the correspondance between Textual representation and IDs
              //  We can build the variables"
              //
              variables += ', "propertyValues":[';
              for (let i=0; i < outProperties.length; i++) {
                if (i != 0 ) variables += ",";
                variables += '{"propertyId":"' + outProperties[i].id + '", "propertyValueId":"' + outProperties[i].valueId + '"}';
              }
              variables += ']';
            } else {
              //
              //  There is an error somewhere. A property or its value is not allowed
              //
              msg.payload = null;
              console.log('Property ' + properties[outProperties].name + ' or its value ' + properties[outProperties].value + ' is not allowed');
              node.status({fill: "red", shape: "dot", text: 'Property ' + properties[outProperties].name + ' or its value ' + properties[outProperties].value + ' is not allowed'});
              node.error('Property ' + properties[outProperties].name + ' or its value ' + properties[outProperties].value + ' is not allowed', msg);
              return;
            }
          } else {
            //
            //  No Properties
            //  We can build a very simple "variables"
            //
          }
          variables += '}}';
          console.log('Creating Space ' + spaceName + ' from template ' + templateId + ' with these data :');
          console.log(variables);
          console.log('------------------');
          //
          //  Issue the create Statement
          //
          wwsGraphQL(bearerToken, host, mutation, BETA_EXP_FLAGS, variables)
          .then((res) => {
            if (res.errors) {
              msg.payload = res.errors;
              console.log('errors creating space ' + spaceName + ' from template ' + templateId);
              console.log(JSON.stringify(res, ' ', 2));
              node.status({fill: "red", shape: "dot", text: 'errors creating space ' + spaceName + ' from template ' + templateId});
              node.error('errors creating space ' + spaceName + ' from template ' + templateId, msg);
            } else {
              msg.payload = res.data.createSpace;
              console.log('Space ' + spaceName + ' CREATED !!');
              console.log(JSON.stringify(res.data));
              node.status({fill: "green", shape: "dot", text: "Space Created !"});
              //
              //  Now we need to modify the properties in the output to be more descriptive
              //
              msg.payload.space.propertyValueIds = _propertiesIdsToNames(msg.payload.space.propertyValueIds, templateProperties);
              //
              //  And now we need to add the name of the status
              //
              let found = false;
              for (let i=0; i < statuses.length; i++) {
                if (msg.payload.space.statusValueId === statuses[i].id) {
                  found = true;
                  msg.payload.space.statusValueName = statuses[i].displayName;
                  break;
                }
              }
              if (!found) {
                //
                //  We cannot Set a status that does not exist
                //
                console.log('Status ' + msg.payload.space.statusValueId + ' is unknown!');
                node.status({fill: "red", shape: "dot", text: 'Status ' + msg.payload.space.statusValueId + ' is unknown!'});
                node.error('Status ' + msg.payload.space.statusValueId + ' is unknown!', msg);
                return;
              }
              node.send(msg);
            }
          }).catch((err) => {
            console.log("Error creating space " + spaceName + ' from template ' + templateId, err);
            node.status({fill: "red", shape: "ring", text: "Error creating space " + spaceName + ' from template ' + templateId});
            node.error("Error creating space " + spaceName + ' from template ' + templateId, err);
          });
        }
      }).catch((err) => {
        console.log("Error while posting GraphQL query to WWS.", err);
        node.status({fill: "red", shape: "ring", text: "Sending query failed..."});
        node.error("Sending query failed...", err);
        return;
      });
      setTimeout(() => {_isInitialized(); }, 2000);       
    });
  }
  

  //
  //  Add Focus
  //
  function wwsAddFocus(config) {
    RED.nodes.createNode(this, config);
    this.application = RED.nodes.getNode(config.application);
    var node = this;

    function _isInitialized() {
      var initialized = false;
      if (tokenFsm.getAccessToken()) {
        node.status({fill: "green", shape: "dot", text: "token available"});
        initialized = true;
      } else {
        node.status({fill: "grey", shape: "dot", text: "uninitialized token"});
      }
      return initialized;
    }
    //
    //  Check for token on start up
    //
    const tokenFsm = node.application.getStateMachine();
    if (!tokenFsm) {
      console.log("wwsAddFocus: No Account Info");
      node.status({fill:"red", shape:"dot", text:"Please configure your account information first!"});
      node.error("Please configure your account information first!");
      return;
    }
    if (!_isInitialized()) {
      const intervalObj = setInterval(() => {
        if (_isInitialized()) {
          clearInterval(intervalObj);
        };
      }, 2000);
    };

    this.on("input", (msg) => {
      var messageId = '';
      var theString = '';
      var actionId = '';
      var lens = '';
      var category = '';
      var thePayload = '';
      //
      //  Which Message needs to be added focus ?
      //
      if ((config.wwsMessageId.trim() === '') && 
          ((msg.wwsMessageId === undefined) || (msg.wwsMessageId.trim() === ''))) {
        //
        //  There is an issue
        //
        console.log("wwsAddFocus: Missing messageID Information");
        node.status({fill:"red", shape:"dot", text:"Missing messageID"});
        node.error('Missing messageID', msg);
        return;
      }
      if (config.wwsMessageId.trim() !== '') {
        messageId = config.wwsMessageId.trim();
      } else {
        messageId = msg.wwsMessageId.trim();
      }

      //
      //  Which String needs to be recognized ?
      //
      if ((config.wwsString.trim() === '') && 
          ((msg.wwsString === undefined) || (msg.wwsString.trim() === ''))) {
        //
        //  There is an issue
        //
        console.log("wwsAddFocus: Missing String Information");
        node.status({fill:"red", shape:"dot", text:"Missing String"});
        node.error('Missing String', msg);
        return;
      }
      if (config.wwsString.trim() !== '') {
        theString = config.wwsString.trim();
      } else {
        theString = msg.wwsString.trim();
      }

      //
      //  Which Actions needs to be proposed as focus ?
      //
      if ((config.wwsActionId.trim() === '') && 
          ((msg.wwsActionId === undefined) || (msg.wwsActionId.trim() === ''))) {
        //
        //  There is an issue
        //
        console.log("wwsAddFocus: Missing ActionID Information");
        node.status({fill:"red", shape:"dot", text:"Missing ActionID"});
        node.error('Missing ActionID', msg);
        return;
      }
      if (config.wwsActionId.trim() !== '') {
        actionId = config.wwsActionId.trim();
      } else {
        actionId = msg.wwsActionId.trim();
      }

      //
      //  Which LENS needs to be proposed as focus ?
      //
      if ((config.wwsLens.trim() === '') && 
          ((msg.wwsLens === undefined) || (msg.wwsLens.trim() === ''))) {
        //
        //  There is an issue
        //
        console.log("wwsAddFocus: Missing Lens Information");
        node.status({fill:"red", shape:"dot", text:"Missing Lens"});
        node.error('Missing Lens', msg);
        return;
      }
      if (config.wwsLens.trim() !== '') {
        lens = config.wwsLens.trim();
      } else {
        lens = msg.wwsLens.trim();
      }

      //
      //  Is there a Category (OPTIONAL) ?
      //
      if (config.wwsCategory.trim() !== '') {
        category = config.wwsCategory.trim();
      } else {
        if ((msg.wwsCategory !== undefined) && (msg.wwsCategory.trim() !== '')) {
          category = msg.wwsCategory.trim();
        } else {
          console.log("wwsAddFocus: Missing OPTIONAL Category Information");
        }
      }

      //
      //  Is there a Payload (OPTIONAL) ?
      //
      if (config.wwsPayload.trim() !== '') {
        thePayload = config.wwsPayload.trim();
      } else {
        if ((msg.wwsPayload !== undefined) && (msg.wwsPayload.trim() !== '')) {
          thePayload = msg.wwsPayload.trim();
        } else {
          console.log("wwsAddFocus: Missing OPTIONAL PAYLOAD Information");
        }
      }

      //
      //  The first thing we have to do is to get the Message from its Id
      //
      var accessToken = this.application.verifyAccessToken(tokenFsm.getAccessToken(), this);
      var bearerToken = msg.wwsToken || accessToken.token.access_token;
      var host = this.application.api;
      var query = _getMessageInformation(messageId);
      //
      //  Retrieve the details of the given Message
      //
      wwsGraphQL(bearerToken, host, query, null, null, "PUBLIC")
      .then((res) => {
        if (res.errors) {
          //
          //  Should NOT BE...
          //
          msg.payload = res.errors;
          console.log('wwsAddFocus: errors from messageId query');
          console.log(JSON.stringify(res.errors));
          node.status({fill: "red", shape: "dot", text: "Errors from messageId query"});
          node.error('Errors from messageId query', msg);
        } else {
          //
          //  Ok, we got the information for the message...
          //
          console.log('wwsAddFocus: Success from graphQL query : message ' + messageId + ' retrieved');
          console.log(JSON.stringify(res.data, ' ', 2));
          node.status({fill: "green", shape: "dot", text: "Message " + messageId + " retrieved..."});
          //
          //  Now we have the message. Check if the message contains the STRING to be annotated.
          //
          if (res.data.message.content.indexOf(theString) >= 0) {
            //
            //  the STRING is part of the message
            //  We can succesfully add the new focus !!
            //
            let mutation = _addFocusMutation(messageId, res.data.message.content, theString, actionId, lens, category, thePayload);
            console.log('wwsAddFocus: String ' + theString + ' found in sentence. Going to add new Focus to ' + messageId + ' ....');
            console.log(mutation);
            //
            //  Retrieve the space info
            //
            wwsGraphQL(bearerToken, host, mutation, null, null, BETA_EXP_FLAGS)
            .then((res) => {
              if (res.errors) {
                msg.payload = res.errors;
                console.log('wwsAddFocus: errors from addFocus mutation');
                console.log(JSON.stringify(res.errors));
                node.status({fill: "red", shape: "dot", text: "Errors from addFocus mutation"});
                node.error("Errors from addFocus mutation", msg);
                return;
              } else {
                //
                //  Successfull Result !
                //
                msg.payload = res.data.addMessageFocus.message;
                msg.payload.annotations = _parseAnnotations(msg.payload.annotations);
                msg.wwsFocusAdded = true;
                console.log('wwsAddFocus: Success from graphQL query');
                console.log(JSON.stringify(res.data));
                node.status({fill: "green", shape: "dot", text: "graphQL Query success"});
                node.send(msg);
              }
            }).catch((err) => {
              console.log("wwsAddFocus: Error while posting addFocus mutation", err);
              node.status({fill: "red", shape: "ring", text: "Posting addFocus mutation failed."});
              node.error("Error while posting addFocus mutation", err);
              return;
            });
          } else {
            //
            //  The string is NOT part of the message.
            //  We do not do anything
            //
            console.log('wwsAddFocus: string ' + theString + ' is not part of the text for messageId ' + messageId + '. Text follows:');
            console.log(JSON.stringify(res.data.message.content, ' ', 2));
            node.status({fill: "yellow", shape: "square", text: "String " + theString + " not in message..."});
            msg.payload = res.data.message;
            msg.payload.annotations = _parseAnnotations(msg.payload.annotations);
            msg.wwsFocusAdded = false;
            node.send(msg);
          }
        }
      })
      .catch((err) => {
        msg.payload = err;
        console.log("wwsAddFocus: Error querying for messageId " + messageId, err);
        node.status({fill: "red", shape: "ring", text: "error querying for messageId"});
        node.error('Error querying for messageId ' + messageId, msg);
      });
      setTimeout(() => {_isInitialized(); }, 2000);
    });
  }

  //
  //  Add Focus
  //
  function wwsActionFulfillment(config) {
    RED.nodes.createNode(this, config);
    this.application = RED.nodes.getNode(config.application);
    var node = this;

    function _isInitialized() {
      var initialized = false;
      if (tokenFsm.getAccessToken()) {
        node.status({fill: "green", shape: "dot", text: "token available"});
        initialized = true;
      } else {
        node.status({fill: "grey", shape: "dot", text: "uninitialized token"});
      }
      return initialized;
    }
    //
    //  Check for token on start up
    //
    const tokenFsm = node.application.getStateMachine();
    if (!tokenFsm) {
      console.log("wwsActionFulfillment: No Account Info");
      node.status({fill:"red", shape:"dot", text:"Please configure your account information first!"});
      node.error("Please configure your account information first!");
      return;
    }
    if (!_isInitialized()) {
      const intervalObj = setInterval(() => {
        if (_isInitialized()) {
          clearInterval(intervalObj);
        };
      }, 2000);
    };

    this.on("input", (msg) => {
      var AFElements = '';
      var AFMutation = '';
      //
      //  Check for the AFElements input
      //
      if ( (msg.wwsAFElements === undefined) || 
           (!Array.isArray(msg.wwsAFElements)) || 
           (msg.wwsAFElements.length <= 0) ) {
        //
        //  There is an issue
        //
        console.log("wwsActionFulfillment: Missing AF Elements Information");
        node.status({fill:"red", shape:"dot", text:"Missing AF Elements"});
        node.error('Missing AF Elements', msg);
        return;
      }
      AFElements = msg.wwsAFElements;

      //
      //  Check for the AFMutation input
      //
      if ((msg.wwsAFMutation === undefined) || (msg.wwsAFMutation.trim() === '')) {
        //
        //  There is an issue
        //
        console.log("wwsActionFulfillment: Missing AF Mutation Information");
        node.status({fill:"red", shape:"dot", text:"Missing AF Mutation"});
        node.error('Missing AF Mutation', msg);
        return;
      }
      AFMutation = msg.wwsAFMutation.trim();

      //
      //  Build the replacement string for the placeholder in the AFMutation string
      //
      var details = '';
      if (config.AF_Operation === 'Attachments') {
        //
        //  We have now to interpret the AFElements array for attachments
        //
        details += 'attachments : [';
        for (let i = 0; i < AFElements.length; i++) {
          if (i !== 0) details += ',';
          details += '{type: CARD, cardInput: {type: INFORMATION, informationCardInput: {';
          details += 'title: "' + (AFElements[i].title) + '",';
          details += 'subtitle: "' + (AFElements[i].subtitle) + '",';
          details += 'text: "' + (AFElements[i].text) + '",';
          if (AFElements[i].text) {
            details += 'date: "' + AFElements[i].date + '",';
          } else {  
            details += 'date: "' + Math.floor(new Date()) + '",';
          }
          details += 'buttons: [';
          for (let j=0; j < AFElements[i].buttons.length; j++) {
            if (j !== 0) details += ',';
            details += '{text: "' + (AFElements[i].buttons[j].text) + '",';
            details += 'payload: "' + (AFElements[i].buttons[j].payload) + '",';
            details += 'style: ';
            if (AFElements[i].buttons[j].isPrimary) {
              details += 'PRIMARY}'
            } else {
              details += 'SECONDARY}'
            }
          }
          details += ']';
          details += '}}}';
        }
        details += ']';
      } else {
        //
        //  We have now to interpret the AFElements array for annotations
        //
        details += 'annotations : [';
        for (let i = 0; i < AFElements.length; i++) {
          if (i !== 0) details += ',';
          details += '{genericAnnotation : {';
          details += 'title: "' + (AFElements[i].title) + '",';
          details += 'text: "' + (AFElements[i].text) + '",';
          details += 'buttons: [';
          for (let j=0; j < AFElements[i].buttons.length; j++) {
            if (j !== 0) details += ',';
            details += '{postbackButton :';
            details += '{title: "' + (AFElements[i].buttons[j].text) + '",';
            details += 'id: "' + (AFElements[i].buttons[j].payload) + '",';
            details += 'style: ';
            if (AFElements[i].buttons[j].isPrimary) {
              details += 'PRIMARY}'
            } else {
              details += 'SECONDARY}'
            }
            details += '}';
          }
          details += ']';
          details += '}}';
        }
        details += ']';
      }

      //
      //  Now we need to replace the placeholder in AFMutation with the details string we just built
      //
      AFMutation = AFMutation.replace('$$$$$$$$', details);
      console.log('wwsActionFulfillment: ready to execute ActionFulfillment mutation (see here) : ');
      console.log(AFMutation);
      //
      //  Send the AF Mutation
      //
      var accessToken = this.application.verifyAccessToken(tokenFsm.getAccessToken(), this);
      var bearerToken = msg.wwsToken || accessToken.token.access_token;
      var host = this.application.api;
      wwsGraphQL(bearerToken, host, AFMutation, null, null, BETA_EXP_FLAGS)
      .then((res) => {
        if (res.errors) {
          msg.payload = res.errors;
          console.log('wwsActionFulfillment: errors from mutation');
          console.log(JSON.stringify(res.errors));
          node.status({fill: "red", shape: "dot", text: "Errors from mutation"});
          node.error("Errors from mutation", msg);
          return;
        } else {
          //
          //  Successfull Result !
          //
          msg.payload = res.data;
          console.log('wwsActionFulfillment: ActionFulfillment mutation succesfully created');
          console.log(JSON.stringify(res.data));
          node.status({fill: "green", shape: "dot", text: "AF Created"});
          node.send(msg);
        }
      }).catch((err) => {
        console.log("wwsActionFulfillment: Error while posting AF mutation", err);
        node.status({fill: "red", shape: "ring", text: "Posting AF mutation failed."});
        node.error("Error while posting AF mutation", err);
        return;
      });
      setTimeout(() => {_isInitialized(); }, 2000);
    });
  }


  //
  //  This node gets the Annotation referred to by a message containing the "Action-Selected" actionId
  //
  function wwsFilterAnnotations(config) {
    RED.nodes.createNode(this, config);
    this.application = RED.nodes.getNode(config.application);
    var node = this;

    function _isInitialized() {
      var initialized = false;
      if (tokenFsm.getAccessToken()) {
        node.status({fill: "green", shape: "dot", text: "token available"});
        initialized = true;
      } else {
        node.status({fill: "grey", shape: "dot", text: "uninitialized token"});
      }
      return initialized;
    }
    function __myJSONparse(str) {
      try {
          let a = JSON.parse(str);
          return a;
      } catch (e) {
          return str;
      }
    }                             

    //
    //  Check for token on start up
    //
    const tokenFsm = node.application.getStateMachine();
    if (!tokenFsm) {
      console.log("wwsFilterAnnotations: No Account Info");
      node.status({fill:"red", shape:"dot", text:"No Account Info"});
      node.error("Please configure your account information first!");
    }
    if (!_isInitialized()) {
      const intervalObj = setInterval(() => {
        if (_isInitialized()) {
          clearInterval(intervalObj);
        }
      }, 2000);
    }

    this.on("input", (msg) => {
      var annotationType;
      //
      //  Get the incoming Annotation Type
      //
      if ((msg.wwsAnnotationType === undefined) || (msg.wwsAnnotationType.trim() === '')) {
        //
        //  There is an issue
        //
        console.log("wwsFilterAnnotations: Missing AnnotationType Information");
        node.status({fill:"red", shape:"dot", text:"Missing AnnotationType Information"});
        node.error('Missing AnnotationType Information', msg);
        return;
      }
      annotationType = msg.wwsAnnotationType.trim();
      if (config.filterOutputs2) {
        //
        //  Check if the incoming actionId is in the list
        //
        let items = config.hidden_string.split(',');
        let theIndex = -1;
        for (let k = 0; k < items.length; k++) {
          if (items[k].trim() === 'message-nlp-all') {
            //
            //  we have the special case where all NLP annotations are delivered through a single output (nlp-all)
            //
            switch (annotationType) {
              case 'message-nlp-keywords':
                if (config.o_messageNlpKeywords) {
                  //
                  //  we deliver this NLP through the NLP-ALL output
                  //
                  theIndex = k;
                }
                break;
              case 'message-nlp-entities':
                if (config.o_messageNlpEntities) {
                  //
                  //  we deliver this NLP through the NLP-ALL output
                  //
                  theIndex = k;
                }
                break;
              case 'message-nlp-docSentiment':
                if (config.o_messageNlpDocSentiment) {
                  //
                  //  we deliver this NLP through the NLP-ALL output
                  //
                  theIndex = k;
                }
                break;
              case 'message-nlp-relations':
                if (config.o_messageNlpRelations) {
                  //
                  //  we deliver this NLP through the NLP-ALL output
                  //
                  theIndex = k;
                }
                break;
              case 'message-nlp-concepts':
                if (config.o_messageNlpConcepts) {
                  //
                  //  we deliver this NLP through the NLP-ALL output
                  //
                  theIndex = k;
                }
                break;
              case 'message-nlp-taxonomy':
                if (config.o_messageNlpTaxonomy) {
                  //
                  //  we deliver this NLP through the NLP-ALL output
                  //
                  theIndex = k;
                }
                break;
              case 'message-nlp-dates':
                if (config.o_messageNlpDates) {
                  //
                  //  we deliver this NLP through the NLP-ALL output
                  //
                  theIndex = k;
                }
                break;
            }
            //
            //  We break the outer loop if found
            //
            if (theIndex >=0) break;
          } else {
            //
            //  This is normal behavior, where each annotationType corresponds to only one output
            //
            if (items[k].trim() === annotationType) {
              theIndex = k;
              break;
            } 
          }
        }
        if (theIndex < 0) {
          //
          //  Very strange situation. AnnotationType is not found ...
          //
          console.log("wwsFilterAnnotations: AnnotationType " + annotationType + ' is NOT Processed');
          node.status({fill:"red", shape:"dot", text:"AnnotationType NOT processed"});
        } else {
          //
          //  Build an array of NULL messages
          //
          let outArray = [];
          for (let k = 0; k < items.length; k++) {
              outArray.push(null);
          }
          //
          //  Now fill the answer in the right position :-)
          //
          outArray[theIndex] = msg;
          //
          //  Provide the answer
          //
          console.log("wwsFilterAnnotations: Filtering annotation " + annotationType + ' through the output '+ theIndex);
          node.status({fill: "green", shape: "dot", text: "annotation processed " + annotationType});
          node.send(outArray);
        }
      } else {
          //
          //  Only one output. All Annotations go to the same
          //
          console.log("wwsFilterAnnotations: Pushing annotation " + annotationType + ' through the single output');
          node.status({fill: "green", shape: "dot", text: "annotation processed " + annotationType});
          node.send(msg);
      }
      setTimeout(() => {_isInitialized();}, 2000);
    });
  }

  RED.nodes.registerType("wws-graphql", wwsGraphQLNode);
  
  RED.nodes.registerType("wws-getMessage", wwsGetMessage);
  
  RED.nodes.registerType("wws-addRemoveMembers", wwsAddRemoveMembers);
  
  RED.nodes.registerType("wws-getPeople", wwsGetPersons);

  RED.nodes.registerType("wws-validateActions", wwsFilterActions);

  RED.nodes.registerType("wws-filterAnnotations", wwsFilterAnnotations);

  RED.nodes.registerType("wws-getTemplate", wwsGetTemplate);

  RED.nodes.registerType("wws-getTemplatedSpace", wwsGetTemplatedSpace);

  RED.nodes.registerType("wws-updateTemplatedSpace", wwsUpdateSpace);

  RED.nodes.registerType("wws-createSpaceFromTemplate", wwsCreateSpaceFromTemplate);

  RED.nodes.registerType("wws-addFocus", wwsAddFocus);

  RED.nodes.registerType("wws-actionFulfillment", wwsActionFulfillment);

  //
  //  Helper functions
  //
  function wwsGraphQL(accessToken, host, query, viewType, variables, operationName) {
    var uri = host + "/graphql";
    /*
    if (operationName) {
      uri += "?operationName=" + operationName;
    }
    if (variables) {
      uri += (uri.includes("?") ? "&" : "?") + "variables=" + variables;
    }
    */
    var options = {
      method: "POST",
      uri: uri,
      headers: {
        "Authorization": "Bearer " + accessToken,
        "x-graphql-view": viewType
      },
      json: true,
      body: {
        query: query
      }
    };
    if (variables) options.body.variables = variables;
    if (operationName) options.body.operationName = operationName;
    return rp(options);
  }

  //
  //  This code comes form the following article : https://stackoverflow.com/questions/26246601/wildcard-string-comparison-in-javascript
  //
  //
  //  This is the "Short code"
  //
  function matchRuleShort(str, rule) {
    return new RegExp("^" + rule.split("*").join(".*") + "$").test(str);
  }
  //
  //  And this is the full code which serves as explanation to the "short code" 
  //
  function matchRuleExpl(str, rule) {
    // "."  => Find a single character, except newline or line terminator
    // ".*" => Matches any string that contains zero or more characters
    rule = rule.split("*").join(".*");

    // "^"  => Matches any string with the following at the beginning of it
    // "$"  => Matches any string with that in front at the end of it
    rule = "^" + rule + "$"

    //Create a regular expression object for matching string
    var regex = new RegExp(rule);

    //Returns true if it finds a match, otherwise it returns false
    return regex.test(str);
  }
  //
  //  Examples
  //
  //alert(
  //  "1. " + matchRuleShort("bird123", "bird*") + "\n" +
  //  "2. " + matchRuleShort("123bird", "*bird") + "\n" +
  //  "3. " + matchRuleShort("123bird123", "*bird*") + "\n" +
  //  "4. " + matchRuleShort("bird123bird", "bird*bird") + "\n" +
  //  "5. " + matchRuleShort("123bird123bird123", "*bird*bird*") + "\n"
  //);
  //
  //  End of code coming form the following article : https://stackoverflow.com/questions/26246601/wildcard-string-comparison-in-javascript
  //  
  function _getMessageInformation(messageId) {
    var query = 'query getMessage { message(id: "' + messageId + '") {';
    query += 'id content contentType annotations';
    query += ' created createdBy {id displayName email customerId presence photoUrl}';
    query += ' updated updatedBy {id displayName email customerId presence photoUrl}';
    query += ' reactions {reaction count viewerHasReacted}'
    query += '}}';
    return query;
  }

  function _propertiesNamesToIds(properties, templates) {
    var outProperties = [];
    for (let i=0; i < properties.length; i++) {
      let found = false;
      let newProp = {};
      for (let j=0; j < templates.length; j++) {
        if (properties[i].name === templates[j].displayName) {
          found = true;
          newProp.id = templates[j].id;
          newProp.type = templates[j].type;
          newProp.displayName = templates[j].displayName;
          if (templates[j].type === "LIST") {
            //
            //  For LISTSs, the value becomes an ID also
            //
            found = false;
            for (let k=0; k < templates[j].acceptableValues.length; k++) {
              if (properties[i].value === templates[j].acceptableValues[k].displayName) {
                found = true;
                newProp.valueId = templates[j].acceptableValues[k].id;
                newProp.valueDisplayName = properties[i].value;
                break;
              }
            }
          } else {
            if (templates[j].type === "BOOLEAN") {
              //
              //  Booleans can only be TRUE or FALSe, right ?
              //
              if ((properties[i].value.toLowerCase() === "true") || (properties[i].value.toLowerCase() === "false")) {
                newProp.valueId = properties[i].value.toUpperCase();
                newProp.valueDisplayName = newProp.valueId;
              } else {
                found = false;
              }
            } else {
              //
              //  Text Attributes. NOTHING to Change
              //
              newProp.valueId = properties[i].value;
              newProp.valueDisplayName = properties[i].value;
            }
          }
          //
          //  We have found... So we can exit the inner loop
          //
          break;
        }
      }
      //
      //  We have done the parsing
      //
      if (!found) {
        //
        //  There was something wrong. Either the name of the property is unknown or the property value is not valid
        //  returning the index of the offending property
        //
        return i;
      } else {
        outProperties.push(newProp);
      }
    }
    return outProperties;
  }
  function _propertiesIdsToNames(properties, templates) {
    var outProperties = [];
    for (let i=0; i < properties.length; i++) {
      let found = false;
      let newProp = {};
      for (let j=0; j < templates.length; j++) {
        if (properties[i].propertyId === templates[j].id) {
          found = true;
          newProp.id = templates[j].id;
          newProp.type = templates[j].type;
          newProp.displayName = templates[j].displayName;
          if (templates[j].type === "LIST") {
            //
            //  For LISTSs, the value becomes an ID also
            //
            found = false;
            for (let k=0; k < templates[j].acceptableValues.length; k++) {
              if (properties[i].propertyValueId === templates[j].acceptableValues[k].id) {
                found = true;
                newProp.valueId = templates[j].acceptableValues[k].id;
                newProp.valueDisplayName = templates[j].acceptableValues[k].displayName;
                break;
              }
            }
          } else {
            if (templates[j].type === "BOOLEAN") {
              //
              //  Booleans can only be TRUE or FALSe, right ?
              //
              if ((properties[i].propertyValueId.toLowerCase() === "true") || (properties[i].propertyValueId.toLowerCase() === "false")) {
                newProp.valueId = properties[i].propertyValueId.toUpperCase();
                newProp.valueDisplayName = newProp.valueId;
              } else {
                found = false;
              }
            } else {
              //
              //  Text Attributes. NOTHING to Change
              //
              newProp.valueId = properties[i].propertyValueId;
              newProp.valueDisplayName = properties[i].propertyValueId;
            }
          }
          //
          //  We have found... So we can exit the inner loop
          //
          break;
        }
      }
      //
      //  We have done the parsing
      //
      if (!found) {
        //
        //  There was something wrong. Either the name of the property is unknown or the property value is not valid
        //  returning the index of the offending property
        //
        return i;
      } else {
        outProperties.push(newProp);
      }
    }
    return outProperties;
  }

  function _AddOrRemoveMutation(spaceId, members, operation) {
    var mutation = 'mutation updateSpaceAddMembers{updateSpace(input: { id: "' + spaceId + '\",  members: [';
    for (let k=0; k < members.length; k++) {
      mutation += '"' + members[k] + '"';
      if (k === (members.length - 1)) {
        mutation += ']';
      } else {
        mutation += ',';
      }
    }
    mutation += ', memberOperation: ' + operation + '}){memberIdsChanged space {id title membersUpdated members {items {id displayName email customerId presence photoUrl}}}}}';
    console.log(mutation);
    return mutation;
  }

  function _createSpaceMutation() {
    var mutation = 'mutation createSpace($input: CreateSpaceInput!) {createSpace(input: $input) {space {';
    mutation += 'id title description visibility';
    mutation += ' team {id displayName teamSettings {appApprovalEnabled}}';
    mutation += ' members {pageInfo {startCursor endCursor hasNextPage hasPreviousPage} items {id displayName email customerId presence photoUrl}}';
    mutation += ' propertyValueIds {propertyId propertyValueId} statusValueId';
    mutation += ' created createdBy {id displayName email customerId presence photoUrl}';
    mutation += ' updated updatedBy {id displayName email customerId presence photoUrl}';
    mutation += ' conversation {id messages(first: 1) {items {id content contentType annotations reactions {reaction count viewerHasReacted}}}}';
    mutation += ' activeMeeting { meetingNumber password}';
    mutation += '}}}';
    console.log(mutation);
    return mutation;
  }
  function _updateSpaceMutation() {
    var mutation = 'mutation updateSpace($input: UpdateSpaceInput!) {updateSpace(input: $input) {space {';
    mutation += 'id title description visibility';
    mutation += ' team {id displayName teamSettings {appApprovalEnabled}}';
    mutation += ' members {pageInfo {startCursor endCursor hasNextPage hasPreviousPage} items {id displayName email customerId presence photoUrl}}';
    mutation += ' propertyValueIds {propertyId propertyValueId} statusValueId';
    mutation += ' created createdBy {id displayName email customerId presence photoUrl}';
    mutation += ' updated updatedBy {id displayName email customerId presence photoUrl}';
    mutation += ' conversation {id messages(first: 1) {items {id content contentType annotations reactions {reaction count viewerHasReacted}}}}';
    mutation += ' activeMeeting { meetingNumber password}';
    mutation += '}}}';
    console.log(mutation);
    return mutation;
  }

  function _getTemplateQuery(templateId) {
    var query = 'query spaceTemplate { spaceTemplate(id: "' + templateId + '") {';
    query += 'id name description teamId labelIds offeringCollaborationType';
    query += ' spaceStatus {acceptableValues {id displayName} defaultValue} requiredApps{items {id}} properties {items {id type displayName ';
    query += '... on SpaceListProperty {defaultValue acceptableValues {id displayName }} ... on SpaceTextProperty {defaultValue} ... on SpaceBooleanProperty {defaultStringValue}}}';
    query += ' created createdBy {id displayName email customerId presence photoUrl} updated updatedBy {id displayName email customerId presence photoUrl}';
    query += '}}';
    console.log(query);
    return query;
  }
  function _getTemplatedSpaceQuery(spaceId) {
    var query = 'query getTemplatedSpace { space(id: "' + spaceId + '") {';
    query += 'id title description visibility';
    //
    //  Template Infos for the space 
    //
    query += ' templateInfo {id name description labelIds';
    query += ' spaceStatus {acceptableValues {id displayName} defaultValue} requiredApps{items {id}} properties {items {id type displayName ';
    query += '... on SpaceListProperty {defaultValue acceptableValues {id displayName }} ... on SpaceTextProperty {defaultValue} ... on SpaceBooleanProperty {defaultStringValue}}}';
    query += ' created createdBy {id displayName email customerId presence photoUrl} updated updatedBy {id displayName email customerId presence photoUrl}}';

    query += ' team {id displayName teamSettings {appApprovalEnabled}}';
    query += ' members {pageInfo {startCursor endCursor hasNextPage hasPreviousPage} items {id displayName email customerId presence photoUrl}}';
    query += ' propertyValueIds {propertyId propertyValueId} statusValueId';
    query += ' created createdBy {id displayName email customerId presence photoUrl}';
    query += ' updated updatedBy {id displayName email customerId presence photoUrl}';
    query += ' conversation {id messages(first: 1) {items {id content contentType annotations reactions {reaction count viewerHasReacted}}}}';
    query += ' activeMeeting {meetingNumber password}';
    query += ' }}}';
    console.log(query);
    return query;
  }

  function _buildTargetedMessage(conversationId, updatedBy, targetDialogId) {
    var mutation = 'mutation {';
    mutation += 'createTargetedMessage(input: {';
    mutation += ' conversationId: "' +  conversationId + '",';
    mutation += ' targetUserId: "' +  updatedBy + '",';
    mutation += ' targetDialogId: "' + targetDialogId + '",';
    mutation += ' $$$$$$$$';
    mutation += ' }) {';
    mutation += ' successful';
    mutation += ' }';
    mutation += '}';
    return mutation;
  }

  function _addFocusMutation(messageId, theSentence, theString, actionId, lens, category, thePayload) {
    var mutation = '';
    mutation += 'mutation {addMessageFocus(input: {';
    mutation += 'messageId: "' + messageId + '", ';
    mutation += 'messageFocus: {';
    mutation += 'phrase: "' + escape(theSentence) + '", ';
    mutation += 'lens: "' + lens + '", ';
    if (category !== '') mutation += 'category: "' + category + '", ';
    mutation += 'actions: ["' + actionId + '"], ';
    mutation += 'confidence: 1, ';
    mutation += 'start: ' + theSentence.indexOf(theString) + ', ';
    mutation += 'end: ' + (theSentence.indexOf(theString) + theString.length) + ', ';
    if (thePayload !== '') mutation += 'payload: "' + escape(thePayload) + '", ';
    mutation += 'version: 1, ';
    mutation += 'hidden: false}}';
    mutation += ') {message {';
    mutation += 'id content contentType annotations';
    mutation += ' created createdBy {id displayName email customerId presence photoUrl}';
    mutation += ' updated updatedBy {id displayName email customerId presence photoUrl}';
    mutation += ' reactions {reaction count viewerHasReacted}'
    mutation += '}}}';
    return mutation;
  }
  /*

  Mutation

  mutation updateSpace ($input:  UpdateSpaceInput!) {updateSpace(input: $input) {space {id title description team {id displayName teamSettings {appApprovalEnabled} } allowGuests visibility modifyMember modifyApp modifySpaceSetting templateId propertyValueIds { propertyId propertyValueId } statusValueId type userSpaceState { unread markedImportant predictedImportant important lastSpaceReadDate } created updated createdBy { id displayName email customerId presence photoUrl } activeMeeting { meetingNumber password }}}}"
variables 

"{"input":{"id":"5b101230e4b09834e0e434d7","propertyValues":[{"propertyId":"acdd0cba-c260-43c1-b77d-0d13526ca1ad","propertyValueId":"TRUE"},{"propertyId":"d2708223-02ca-4a28-b03b-4a9088fc589b","propertyValueId":"due"},{"propertyId":"e1b35006-2c50-4cc6-aab8-a3d1155db4c2","propertyValueId":"FALSE"},{"propertyId":"6409ec4c-1cbc-4f32-a9d8-e5113baaad46","propertyValueId":"9ad4db4c-3e6d-403e-8519-979f12f58d21"},{"propertyId":"66d8289c-706f-4223-b0b4-7def0a2ebfc9","propertyValueId":"00fddd0d-5aaf-487f-90db-ba98bcee321e"},{"propertyId":"285e5b11-ec29-4e72-b938-5dbaf8923442","propertyValueId":"uno"}]}}"




*/
};