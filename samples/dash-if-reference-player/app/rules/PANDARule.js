
function PandaRuleClass() {
    let factory = dashjs.FactoryMaker;
    let SwitchRequest = factory.getClassFactoryByName('SwitchRequest');
    let MetricsModel = factory.getSingletonFactoryByName('MetricsModel');
    let DashMetrics = factory.getSingletonFactoryByName('DashMetrics');
    let DashManifestModel = factory.getSingletonFactoryByName('DashManifestModel');
    let StreamController = factory.getSingletonFactoryByName('StreamController');
    let Debug = factory.getSingletonFactoryByName('Debug');
    let BufferController = factory.getSingletonFactoryByName('BufferController');

    let kappa = 0.28,
    omega = 0.3,
    alpha = 0.2,
    beta = 0.2,
    epsilon = 0.15,
    bMin = (26);


    let context = this.context;
    let instance,
        logger;

    function setup() {
        logger = Debug(context).getInstance().getLogger(instance);
    }

    function getMaxIndex(rulesContext) {

        let streamController = StreamController(context).getInstance();
        let dashManifest = DashManifestModel(context).getInstance();
        let metricsModel = MetricsModel(context).getInstance();
        var mediaType = rulesContext.getMediaInfo().type;
        var metrics = metricsModel.getMetricsFor(mediaType, true);
        var dashMetrics = DashMetrics(context).getInstance();
        let abrController = rulesContext.getAbrController();
        let bufferLevel = dashMetrics.getCurrentBufferLevel(mediaType, true);

        let segmentCounter = dashMetrics.getCurrentBufferLevel(mediaType, true);
        let requests = dashMetrics.getHttpRequests(mediaType),
        m_lastVideoIndex = 0,
        lastRequest = null,
        i,
        time_cur,
        lastBandwidthShare,
        lastSmoothBandwidthShare,
        currentRequest = null;



        m_lastTargetInterrequestTime = 0,
        nextRepIndex = 0,
        nextDownloadDelay = 0,
        decisionCase = 0,
        delayDecisionCase = 0,

        // Get last valid request
        i = requests.length - 1;
        while (i >= 0 && lastRequest === null) {
            currentRequest = requests[i];
            if (currentRequest._tfinish && currentRequest.trequest && currentRequest.tresponse && currentRequest.trace && currentRequest.trace.length > 0) {
                lastRequest = requests[i];
            }
            i--;
        }

        if (lastRequest === null) {
            logger.debug("[CustomRules][" + mediaType + "][DownloadRatioRule] No valid requests made for this stream yet, bailing.");
            return SwitchRequest(context).create();
        }

        time_cur = (lastRequest._tfinish.getTime() - lastRequest.trequest.getTime()) / 1000;
        let decisionTime = time_cur;
        let delay = 0;

        if(segmentCounter == 0){
            console.log("ENDING");
            return nextRepIndex
        }

        let averageBitrate = abrController.getQualityFor(mediaType, streamController.getActiveStreamInfo()),
        actualInterrquestTime = (lastRequest.requestEndDate - lastRequest.requestStartDate);

        let throughputMeasured = (averageBitrate*bufferLevel)/actualInterrquestTime;


        if(segmentCounter == 1){
            let lastBandwidthShare = throughputMeasured;
            let lastSmoothBandwidthShare = lastBandwidthShare;
        }

        if(time_cur - lastRequest.requestStartDate > m_lastTargetInterrequestTime * 1e6){
            actualInterrquestTime = (time_cur - lastRequest.requestStartDate);
        }
        else{
            actualInterrquestTime = m_lastTargetInterrequestTime;
        }

        let bandwidthShare = (kappa * (omega - Math.max(0, lastBandwidthShare - throughputMeasured))) * actualInterrquestTime + lastBandwidthShare;

        if(bandwidthShare < 0){
            bandwidthShare = 0;
        }

        lastBandwidthShare = bandwidthShare;

        let smoothBandwidthShare = bandwidthShare;

        smoothBandwidthShare = ((-alpha * (lastSmoothBandwidthShare - bandwidthShare)) * actualInterrquestTime) + lastSmoothBandwidthShare;

        lastSmoothBandwidthShare = smoothBandwidthShare;
        let deltaUp = omega + epsilon * smoothBandwidthShare;
        let deltaDown = omega;

        let rUp = FindLargest(smoothBandwidthShare, segmentCounter - 1, deltaUp, rulesContext);
        let rDown = FindLargest(smoothBandwidthShare, segmentCounter - 1, deltaDown, rulesContext);

        let videoIndex;

        //let averageBitrate = abrController.getQualityFor(mediaType, streamController.getActiveStreamInfo()),
        let averageBitrateForrUp = abrController.getQualityFor(mediaType, rUp),
        averageBitrateforrDown = abrController.getQualityFor(mediaType, rDown);


        if((averageBitrate) < averageBitrateForrUp){
            videoIndex = rUp;

        }
        else if((averageBitrateForrUp <= averageBitrate) && (averageBitrate <= averageBitrateforrDown)){
            videoIndex = m_lastVideoIndex
        }
        else {
            videoIndex = rDown;
        }
        m_lastVideoIndex = videoIndex;

        //SCHEDULING BELOW::::

        let targetInterrequestTime = Math.max(0 , ((averageBitrate * bufferLevel) / smoothBandwidthShare) + beta * (bufferLevel - bMin));

        if(lastRequest.requestEndDate - lastRequest.requestStartDate < m_lastTargetInterrequestTime){
            delay = m_lastTargetInterrequestTime - (lastRequest.requestEndDate - lastRequest.requestStartDate);

        }
        else{
            delay = 0;
        }

        m_lastTargetInterrequestTime = targetInterrequestTime;

        bufferLevel = dashMetrics.getCurrentBufferLevel(mediaType, true) - (time_cur - lastRequest.requestEndDate);
    
        nextRepIndex = videoIndex;
        nextdownloadDelay = delay;
        decisionTime = time_cur;
        decisionCase = 0;
        delayDecisionCase = 0;

        return nextRepIndex;
    }


    function FindLargest(smoothBandwidthShare, segmentCounter, delta, rulesContext){
        let abrController = rulesContext.getAbrController();
        let streamController = StreamController(context).getInstance();
        var mediaType = rulesContext.getMediaInfo().type;




        let largestBitrateIndex = 0;
        let averageBitrate = abrController.getQualityFor(mediaType, streamController.getActiveStreamInfo());

        for (i = 0; i <= abrController.getMaxAllowedIndexFor(mediaType, streamController.getActiveStreamInfo()) ; i++) {
            let currentBitrate = abrController.getQualityFor(mediaType, i);

            if (currentBitrate <= (smoothBandwidthShare - delta)){
                largestBitrateIndex = i;
            }
            return largestBitrateIndex;
        }
    }

    instance = {
        getMaxIndex: getMaxIndex
    };

    setup();

    return instance;
}
PandaRuleClass.__dashjs_factory_name = 'PandaRule';
PandaRule = dashjs.FactoryMaker.getClassFactory(PandaRuleClass);

