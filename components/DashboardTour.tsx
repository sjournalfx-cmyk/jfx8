import React, { useState, useEffect, useCallback } from 'react';
import Joyride, { STATUS, CallBackProps, Placement } from 'react-joyride';
import { useLocalStorage } from '../hooks/useLocalStorage'; // Assuming this hook exists for managing localStorage

interface Step {
  target: string;
  content: React.ReactNode;
  placement?: Placement;
  title?: string;
}

const DASHBOARD_TOUR_STORAGE_KEY = 'jfx_dashboard_tour_completed';

const DashboardTour: React.FC = () => {
  const [runTour, setRunTour] = useState<boolean>(false);
  const [tourCompleted, setTourCompleted] = useLocalStorage<boolean>(DASHBOARD_TOUR_STORAGE_KEY, false);

  const steps: Step[] = [
    {
      target: '.dashboard-layout-presets',
      content: 'Explore different dashboard layouts to suit your trading style.',
      placement: 'right',
      title: 'Layout Presets',
    },
    {
      target: '.ai-assistant-widget',
      content: 'Leverage our AI Assistant for insights, trade analysis, and more.',
      placement: 'bottom',
      title: 'AI Assistant',
    },
    // Add more steps as needed to highlight other features
    // {
    //   target: '.some-other-feature',
    //   content: 'This is another feature you can explore.',
    //   placement: 'top',
    //   title: 'Another Feature',
    // },
  ];

  const handleJoyrideCallback = useCallback((data: CallBackProps) => {
    const { status } = data;

    if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
      setTourCompleted(true);
      setRunTour(false);
    }
  }, [setTourCompleted]);

  useEffect(() => {
    // Only run the tour if it hasn't been completed before
    if (!tourCompleted) {
      // Add a small delay to ensure the DOM elements are loaded
      const timer = setTimeout(() => {
        setRunTour(true);
      }, 1000); // Adjust delay as needed
      return () => clearTimeout(timer);
    }
  }, [tourCompleted]);

  return (
    <Joyride
      callback={handleJoyrideCallback}
      continuous={true}
      hideCloseButton={false}
      run={runTour}
      scrollToFirstStep={true}
      showProgress={true}
      steps={steps}
      styles={{
        options: {
          zIndex: 10000,
        },
        spotlight: {
          backgroundColor: 'rgba(0,0,0,0.5)',
        },
        tooltip: {
          backgroundColor: '#333',
          color: '#fff',
          textAlign: 'center',
          padding: '15px',
          borderRadius: '8px',
        },
        buttonNext: {
          backgroundColor: '#4CAF50', // Green color for next button
        },
        buttonBack: {
          backgroundColor: '#f44336', // Red color for back button
        },
        buttonSkip: {
          backgroundColor: '#FFC107', // Amber color for skip button
        },
        buttonClose: {
          color: '#fff',
        },
      }}
    />
  );
};

export default DashboardTour;
