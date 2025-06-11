import React, { ReactNode } from 'react';

interface StatCardProps {
  title: string;
  value: string;
  icon: ReactNode;
  description: string;
  color: string;
  subValue?: string;
}

const StatCard: React.FC<StatCardProps> = ({ 
  title, 
  value, 
  icon, 
  description, 
  color, 
  subValue 
}) => {
  return (
    <div className={`${color} border rounded-lg p-6 transition-all duration-200 hover:shadow-md`}>
      <div className="flex justify-between items-start">
        <div>
          <h3 className="text-gray-600 text-sm font-medium">{title}</h3>
          <div className="mt-2 flex flex-col">
            <p className="text-2xl font-bold text-gray-900">{value}</p>
            {subValue && <p className="text-gray-500 text-sm">{subValue}</p>}
          </div>
          <p className="mt-2 text-gray-500 text-sm">{description}</p>
        </div>
        <div className="p-3 rounded-full bg-white shadow-sm">
          {icon}
        </div>
      </div>
    </div>
  );
};

export default StatCard;