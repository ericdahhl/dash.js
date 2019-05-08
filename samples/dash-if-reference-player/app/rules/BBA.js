
function BBAClass() {

    let factory = dashjs.FactoryMaker;
    let SwitchRequest = factory.getClassFactoryByName('SwitchRequest');
    let MetricsModel = factory.getSingletonFactoryByName('MetricsModel');
    let DashMetrics = factory.getSingletonFactoryByName('DashMetrics');
    let DashManifestModel = factory.getSingletonFactoryByName('DashManifestModel');
    let StreamController = factory.getSingletonFactoryByName('StreamController');
    let StreamProcessor = factory.getSingletonFactoryByName('StreamProcessor');
    let Debug = factory.getSingletonFactoryByName('Debug');
    let BufferController = factory.getSingletonFactoryByName('BufferController');
    let MediaPlayerModel = factory.getSingletonFactoryByName("MediaPlayerModel");

   
    let bufferMax; //To store buffer capacity
    let mediaPlayerModel; //Default
    let instance, //Default
        throughputArray, //Array to store segment download throughput
        bitrateArray, //Array to store bitrate of downloaded segment
        plusIndex, //Index of one higher bitrate than the current bitrate
        minIndex, //min Index as in BBA paper
        minusIndex, //Index of one lower bitrate than the current bitrate
av, //last value of throughput
        bv, //last value of bitrate
        actBuff, //as in BBA paper
        fBuffNow, //temproray variable
        lowRes, //lower reservoir
        upRes, // upper reservoir
        buffInterval, //temproray variable
        bitrate, //array to store list of availalbe bitrate
        bitrateCount, //number of available bitrate
        adapter; //Default
    let context = this.context;


    function setup() {
        throughputArray = [];
        bitrateArray = [];
        plusIndex = 0;
        minIndex = 0;
        minusIndex = 0;
        av = 0;
        bv = 0;
        actBuff = 0;
        fBuffNow = 0;
        lowRes = 0;
        upRes = 0;
        buffInterval = 0;
        bitrate = [];
        bitrateCount = 0;
    }

    /* Function to return bitrate corresponds to current buffer occupancy*/
    function mapBitrate(buff) {
        var returnBitrate = 0;
        returnBitrate = bitrate[0] + (((bitrate[bitrateCount - 1] - bitrate[0]) /
(bufferMax - lowRes - upRes)) * (buff - lowRes));
        return (returnBitrate / 1000);
    }

    //Store throughput in array
    function storeLastRequestThroughputByType(type, throughput) {
        throughputArray[type] = throughputArray[type] || [];
        //Due to bug in Dash.js, some very high flase throughput were getting reported. Remove it, if bug is fixed in thee impremented version.
        if (throughput < 100000000) {
            throughputArray[type].push(throughput);
        }
    }

    //Throughput Predection and smoothing
    /*Just the last throughput*/
    function averageThroughputByType(type) {
        var arrThroughput = throughputArray[type];
        var lenThroughput = arrThroughput.length;
        av = arrThroughput[lenThroughput - 1];
        return (av);
    }



    function getMaxIndex(rulesContext) {

        let dashMetrics = DashMetrics(context).getInstance();
        let metricsModel = MetricsModel(context).getInstance();

        var averageThroughput; 
        var lastRequestThroughput; 
        var mediaInfo = rulesContext.getMediaInfo(); 

        let mediaType = rulesContext.getMediaInfo().type;

        let dashManifest = DashManifestModel(context).getInstance();
        let streamController = StreamController(context).getInstance();
        let abrController = rulesContext.getAbrController();
        let current = abrController.getQualityFor(mediaType, streamController.getActiveStreamInfo());
        var metrics = metricsModel.getMetricsFor(mediaType, true);
        var streamProcessor = rulesContext.getStreamInfo(); 
        var isDynamic = streamProcessor && streamProcessor.manifestInfo ? streamProcessor.manifestInfo.isDynamic : null;
        var lastRequest = dashMetrics.getCurrentHttpRequest(metrics);
        var bufferStateVO = (metrics.BufferState.length > 0) ? metrics.BufferState[metrics.BufferState.length - 1] : null; //Default
        var bufferLevelVO = (metrics.BufferLevel.length > 0) ? metrics.BufferLevel[metrics.BufferLevel.length - 1] : null; //Default
        var switchRequest = SwitchRequest(context).create(SwitchRequest.NO_CHANGE, SwitchRequest.WEAK);
        let streamInfo = rulesContext.getStreamInfo(); //Stram information
        let duration = streamInfo.manifestInfo.duration; //Duration of video
        let bestR; // To store the bitrate to be requested
        var newQuality = 0; //Newly selected bitrate
        var buff = dashMetrics.getCurrentBufferLevel(metrics, true) ? dashMetrics.getCurrentBufferLevel(metrics, true) : 0.0; //current buffr occupancy
        var repSwitch = dashMetrics.getCurrentRepresentationSwitch(metrics);
        var streamIdx = streamInfo.index;
        var currentIndex = abrController.getTopQualityIndexFor(mediaType, streamIdx);
        let bitrate = mediaInfo.bitrateList.map(b => b.bandwidth);
        let i;
        let lowResRatio = 90 / 240; //lower reservior ratio
        let upResRatio = 24 / 240; //upper reservoir ratio
        bitrateCount = bitrate.length;
        mediaPlayerModel = MediaPlayerModel(context).getInstance();

        if (duration >= 600) {
            bufferMax = 60;
        } else {
            bufferMax = 30;
        }

        //dash.js has variable buffer basd on duration of video. Lower and upper reserve are maintained in same ratio of buffer as given in paper
        lowRes = bufferMax * lowResRatio;
        upRes = bufferMax * upResRatio;
        actBuff = bufferMax - (lowRes + upRes); //cussion in algo
        //Getting throughput// /*Value not necessary for BBA*/
        if (!metrics || !lastRequest || lastRequest.type !== 'MediaSegment' ||
         !bufferStateVO || !bufferLevelVO ) {
            return switchRequest;
        }
        let downloadTimeInMilliseconds;

        if (lastRequest.trace && lastRequest.trace.length) {

            downloadTimeInMilliseconds = lastRequest._tfinish.getTime() - lastRequest.tresponse.getTime() + 1; //Make sure never 0 we divide by this value. Avoid infinity!
            const bytes = lastRequest.trace.reduce((a, b) => a + b.b[0], 0);
            lastRequestThroughput = Math.round((bytes * 8) / (downloadTimeInMilliseconds / 1000));
            storeLastRequestThroughputByType(mediaType, lastRequestThroughput);
        }
        av = averageThroughputByType(mediaType) / 1000;
        fBuffNow = mapBitrate(buff);

        

        if (currentIndex == (bitrateCount - 1))
        {
            plusIndex = bitrateCount - 1;
        }
        else
        {
            plusIndex =  minIndex + 1;

        }
        if (currentIndex == 0)
        {
            minusIndex = 0;
        }
        else
        {
            minusIndex = minIndex - 1;
        }
        if (buff <= lowRes)
        {
            minIndex = 0;
        }
        else if (buff >= (actBuff + lowRes))
        {
            minIndex = bitrateCount - 1;
        }
        else if (fBuffNow >= plusIndex)
        {
            for (i = 0; i < bitrateCount && (bitrate[i] / 1000) < fBuffNow; i++)
            {
                minIndex = i;
            }
            // minIndex = fBuffNow-1;
        }
        else if (fBuffNow <= minusIndex)
        {
            for (i = bitrateCount - 1; i >= 0 && (bitrate[i] / 1000) > fBuffNow; i--)
            {
                minIndex = i;
            }
            //minIndex =  fBuffNow+1;
        }
        else
        {
            minIndex = currentIndex;
        }
        

        ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
        //abrController.setAverageThroughput(mediaType, lastRequestThroughput);
        if (abrController.getAbandonmentStateFor(mediaType) !== abrController.ABANDON_LOAD) {
            if (bufferStateVO.state === 'bufferLoaded' || isDynamic) {
                bestR = Math.ceil(bitrate[minIndex] / 1000);
                newQuality = abrController.getQualityForBitrate(mediaInfo, bestR);
                //streamController.setTimeToLoadDelay(0); // TODO Watch out for seek event - no delay when seeking.!!
                switchRequest = SwitchRequest(context).create(newQuality, SwitchRequest.STRONG);


                return switchRequest;
            }

            if (switchRequest.value !== SwitchRequest.NO_CHANGE && switchRequest.value !== current) {
                    switchRequest.priority === SwitchRequest.DEFAULT ? 'Default' :
                        switchRequest.priority === SwitchRequest.STRONG ? 'Strong' : 'Weak', 'Average throughput', Math.round(averageThroughput), 'kbps';
                    return switchRequest;
            }
        }


    }




    function reset() {
        setup();
    }

    instance = {
        getMaxIndex: getMaxIndex,
        reset: reset
    };

    setup();
    return instance;

}

BBAClass.__dashjs_factory_name = 'BBA';
BBA = dashjs.FactoryMaker.getClassFactory(BBAClass);
