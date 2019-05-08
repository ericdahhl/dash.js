function FestiveRuleClass() {
    let factory = dashjs.FactoryMaker;
    let SwitchRequest = factory.getClassFactoryByName('SwitchRequest');
    let MetricsModel = factory.getSingletonFactoryByName('MetricsModel');
    let DashMetrics = factory.getSingletonFactoryByName('DashMetrics');
    let DashManifestModel = factory.getSingletonFactoryByName('DashManifestModel');
    let StreamController = factory.getSingletonFactoryByName('StreamController');
    let Debug = factory.getSingletonFactoryByName('Debug');
    let BufferController = factory.getSingletonFactoryByName('BufferController');

    let context = this.context;
    let instance,
        logger;

    function setup() {
        logger = Debug(context).getInstance().getLogger(instance);
    }

    var alpha = 12,
    qualityLog = [],
    horizon = 5,
    switchUpCount = 0,
    switchUpThreshold = [0, 1, 2, 3, 4],
    p = 0.85,
    lastIndex = -1;
    
    //b stands for bandwidth.
    function getStabilityScore (b, b_ref, b_cur) {
        var score = 0,
        n = 0;
        if (lastIndex >= 1) {
            for (var i = Math.max(0, lastIndex + 1 - horizon) ; i <= lastIndex - 1; i++) {
                if (qualityLog[i] != qualityLog[i + 1]) {
                    n = n + 1;
                }
            }
        }
        if (b != b_cur) {
            n = n + 1;
        }
        score = Math.pow(2, n);
        return score;
    }

    function getEfficiencyScore (b, b_ref, w, bitrateArray) {
        var score = 0;
        score = Math.abs(bitrateArray[b] / Math.min(w, bitrateArray[b_ref]) - 1);
        return score;
    }

    function getCombinedScore (b, b_ref, b_cur, w, bitrateArray) {
        var stabilityScore = 0,
        efficiencyScore = 0,
        totalScore = 0;
        stabilityScore = getStabilityScore(b, b_ref, b_cur);
        efficiencyScore = getEfficiencyScore(b, b_ref, w, bitrateArray);
        totalScore = stabilityScore + alpha * efficiencyScore;
        return totalScore;
    }

    function getMaxIndex(rulesContext) {

        
        let streamController = StreamController(context).getInstance();
        let dashManifest = DashManifestModel(context).getInstance();
        let metricsModel = MetricsModel(context).getInstance();
        var mediaType = rulesContext.getMediaInfo().type;
        var metrics = metricsModel.getMetricsFor(mediaType, true);
        var dashMetrics = DashMetrics(context).getInstance();
        let abrController = rulesContext.getAbrController();
        let bitrate = 0,
        tmpBitrate = 0,
        b_target = 0,
        b_ref = 0,
        b_cur = abrController.getQualityFor(mediaType, streamController.getActiveStreamInfo()),
        prevQuality = abrController.getQualityFor(mediaType, streamController.getActiveStreamInfo()),
        score_cur = 0,
        score_ref = 0,
        lastRequested = null,
        currentRequest = null,
        requests = dashMetrics.getHttpRequests(mediaType),
        bitrateArray = rulesContext.getMediaInfo().bitrateList,
        currentRepresentation = rulesContext.getRepresentationInfo(),
        bwPrediction = dashManifest.getBandwidth(currentRepresentation);



        // TODO: implement FESTIVE logic
        // 1. log previous quality

        // Get last valid request
        console.log(requests);
        console.log(mediaType);
        i = requests.length - 1;
        while (i >= 0 && lastRequested === null) {
            currentRequest = requests[i];
            if (currentRequest._tfinish && currentRequest.trequest && currentRequest.tresponse && currentRequest.trace && currentRequest.trace.length > 0) {
                lastRequested = requests[i];
            }
            i--;
        }

        qualityLog[lastRequested] = prevQuality;
        lastIndex = lastRequested;
        // 2. compute b_target
        tmpBitrate = p * bwPrediction;
        for (var i = 4; i >= 0; i--) { // todo: use bitrateArray.length
            if (bitrateArray[i] <= tmpBitrate) {
                b_target = i;
                break;
            }
            b_target = i;
        }
        logger.debug("-----FESTIVE: lastRequested=" + lastRequested + ", bwPrediction=" + bwPrediction + ", b_target=" + b_target + ", switchUpCount=" + switchUpCount);
        // 3. compute b_ref
        if (b_target > b_cur) {
            switchUpCount = switchUpCount + 1;
            if (switchUpCount > switchUpThreshold[b_cur]) {
                b_ref = b_cur + 1;
            } else {
                b_ref = b_cur;
            }
        } else if (b_target < b_cur) {
            b_ref = b_cur - 1;
            switchUpCount = 0;
        } else {
            b_ref = b_cur;
            switchUpCount = 0; // this means need k consecutive "up" to actually switch up
        }
        // 4. delayed update
        if (b_ref != b_cur) { // need to switch
            // compute scores
            score_cur = getCombinedScore(b_cur, b_ref, b_cur, bwPrediction, bitrateArray);
            score_ref = getCombinedScore(b_ref, b_ref, b_cur, bwPrediction, bitrateArray);
            if (score_cur <= score_ref) {
                bitrate = b_cur;
            } else {
                bitrate = b_ref;
                if (bitrate > b_cur) { // clear switchupcount
                    switchUpCount = 0;
                }
            }
        } else {
            bitrate = b_cur;
        }
        logger.debug("-----FESTIVE: bitrate=" + bitrate + ", b_ref=" + b_ref + ", b_cur=" + b_cur);
        // 5. return
        
        if (lastRequested !== null) {
            console.log(abrController.getThroughputHistory().getSafeAverageThroughput('video', true), (lastRequested._tfinish.getTime() - lastRequested.trequest.getTime()) / 1000);
        }
        
        // var xhr = new XMLHttpRequest();
        //     xhr.open("POST", "http://localhost:3001/to_csv", true);
        //     xhr.setRequestHeader('Content-Type', 'application/json');
        //     xhr.setRequestHeader('Access-Control-Allow-Origin', '*');
        //     xhr.send(JSON.stringify([{bitrate: bitrate}]));
        //     xhr.onload = function() {
        //         console.log(this.responseText);
        //     }

        return bitrate;
    };

    instance = {
        getMaxIndex: getMaxIndex
    };

    setup();

    return instance;
};

FestiveRuleClass.__dashjs_factory_name = 'FestiveRule';
FestiveRule = dashjs.FactoryMaker.getClassFactory(FestiveRuleClass);
